const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');
const {
  recordGenerationFinished,
  recordGenerationQueueWait,
  recordGenerationWorkerRestart,
  setGenerationPoolMetrics,
} = require('../../utils/metrics');

function elapsedMs(startedAt) {
  if (!startedAt) return undefined;
  return Number(process.hrtime.bigint() - startedAt) / 1e6;
}

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function defaultWorkerCount() {
  const available = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  return Math.max(1, Math.min(2, available - 1));
}

// A generation uses ~15 MB of heap. The limits stop one runaway job from
// growing until the whole instance is killed (pm2 max_memory_restart, the
// Vercel function limit); only its own worker dies and is replaced.
function workerResourceLimits() {
  return {
    maxOldGenerationSizeMb: positiveInteger(process.env.GENERATION_WORKER_MAX_OLD_MB, 128),
    maxYoungGenerationSizeMb: positiveInteger(process.env.GENERATION_WORKER_MAX_YOUNG_MB, 32),
    stackSizeMb: 4,
  };
}

function generationError(message, { status = 500, code } = {}) {
  return Object.assign(new Error(message), { status, code });
}

// Only errors the generator marks as input errors (status 4xx) reach the
// client as such; anything else is a server fault whose message is masked in
// production. The worker's stack is kept only for the server-side error log.
function errorFromWorker(payload = {}) {
  const status = Number(payload.status);
  const isClientError = Number.isInteger(status) && status >= 400 && status < 500;
  const error = generationError(payload.message || 'Plan generation failed.', {
    status: isClientError ? status : 500,
    code: payload.code,
  });
  error.name = payload.name || 'Error';
  if (isClientError) error.expose = true;
  else if (payload.stack) error.stack = payload.stack;
  return error;
}

class PlanGenerationPool {
  constructor(options = {}) {
    this.workerCount = positiveInteger(options.workerCount, defaultWorkerCount());
    this.maxQueue = positiveInteger(options.maxQueue, this.workerCount * 4);
    this.jobTimeoutMs = positiveInteger(options.jobTimeoutMs, 15000);
    this.workerPath = options.workerPath || path.join(__dirname, 'generationWorker.js');
    this.resourceLimits = options.resourceLimits || workerResourceLimits();
    this.workers = [];
    this.queue = [];
    this.nextJobId = 1;
    this.closed = false;

    for (let index = 0; index < this.workerCount; index += 1) {
      this.spawnWorker(index);
    }
    this.refreshMetrics();
  }

  spawnWorker(index) {
    if (this.closed) return;

    const worker = new Worker(this.workerPath, { resourceLimits: this.resourceLimits });
    const slot = {
      worker,
      ready: false,
      busy: false,
      retiring: false,
      currentJob: null,
      lastError: null,
    };
    this.workers[index] = slot;

    worker.on('message', (message) => this.handleMessage(slot, message));
    worker.on('error', (error) => {
      slot.lastError = error;
    });
    worker.on('exit', (code) => this.handleExit(index, slot, code));
  }

  handleMessage(slot, message) {
    if (message?.type === 'ready') {
      slot.ready = true;
      this.dispatch();
      if (!slot.busy) slot.worker.unref();
      this.refreshMetrics();
      return;
    }

    const job = slot.currentJob;
    if (!job || message?.id !== job.id) return;

    slot.currentJob = null;
    slot.busy = false;
    clearTimeout(job.timer);

    if (message.type === 'result') {
      const planOutcome = message.plan?.status === 'error'
        ? 'impossible'
        : (message.plan?.diagnostics?.status === 'warning' ? 'warning' : 'success');
      recordGenerationFinished({
        input: job.input,
        outcome: planOutcome,
        totalMs: elapsedMs(job.enqueuedAt),
        workerMs: elapsedMs(job.startedAt),
        plan: message.plan,
      });
      job.resolve({ plan: message.plan, traceEvents: message.traceEvents || [] });
    } else {
      const error = errorFromWorker(message.error);
      error.traceEvents = message.traceEvents || [];
      recordGenerationFinished({
        input: job.input,
        outcome: Number(error.status) < 500 ? 'validation_error' : 'worker_error',
        totalMs: elapsedMs(job.enqueuedAt),
        workerMs: elapsedMs(job.startedAt),
      });
      job.reject(error);
    }

    slot.worker.unref();
    this.dispatch();
    this.refreshMetrics();
  }

  handleExit(index, slot, code) {
    if (this.workers[index] !== slot) return;

    const job = slot.currentJob;
    if (job) {
      clearTimeout(job.timer);
      recordGenerationFinished({
        input: job.input,
        outcome: 'worker_exit',
        totalMs: elapsedMs(job.enqueuedAt),
        workerMs: elapsedMs(job.startedAt),
      });
      const outOfMemory = slot.lastError?.code === 'ERR_WORKER_OUT_OF_MEMORY';
      const exitError = outOfMemory
        ? generationError('This plan was too large to generate. Please try again with fewer restrictions.', {
          status: 503,
          code: 'generation-worker-out-of-memory',
        })
        : generationError(`Plan generation worker exited unexpectedly (${code}).`, {
          status: 503,
          code: 'generation-worker-exited',
        });
      if (slot.lastError) exitError.cause = slot.lastError;
      job.reject(exitError);
    }

    this.workers[index] = null;
    if (!this.closed) {
      if (!slot.retiring) recordGenerationWorkerRestart(slot.lastError ? 'error' : 'exit');
      this.spawnWorker(index);
    }
    this.refreshMetrics();
  }

  handleTimeout(job) {
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      recordGenerationFinished({
        input: job.input,
        outcome: 'queue_timeout',
        totalMs: elapsedMs(job.enqueuedAt),
      });
      job.reject(generationError('Plan generation queue timed out.', {
        status: 503,
        code: 'generation-queue-timeout',
      }));
      this.refreshMetrics();
      return;
    }

    const slot = this.workers.find((candidate) => candidate?.currentJob === job);
    if (!slot) return;

    slot.currentJob = null;
    slot.busy = false;
    slot.retiring = true;
    recordGenerationFinished({
      input: job.input,
      outcome: 'timeout',
      totalMs: elapsedMs(job.enqueuedAt),
      workerMs: elapsedMs(job.startedAt),
    });
    recordGenerationWorkerRestart('timeout');
    job.reject(generationError('Plan generation timed out.', {
      status: 504,
      code: 'generation-timeout',
    }));
    slot.worker.terminate().catch(() => {});
    this.refreshMetrics();
  }

  run(input, options = {}) {
    if (this.closed) {
      recordGenerationFinished({ input, outcome: 'shutdown', totalMs: 0 });
      return Promise.reject(generationError('Plan generation is shutting down.', {
        status: 503,
        code: 'generation-shutting-down',
      }));
    }

    if (this.queue.length >= this.maxQueue) {
      recordGenerationFinished({ input, outcome: 'overloaded', totalMs: 0 });
      return Promise.reject(generationError('Plan generation is busy. Please try again shortly.', {
        status: 503,
        code: 'generation-overloaded',
      }));
    }

    return new Promise((resolve, reject) => {
      const job = {
        id: this.nextJobId,
        input,
        options,
        resolve,
        reject,
        timer: null,
        enqueuedAt: process.hrtime.bigint(),
        startedAt: null,
      };
      this.nextJobId += 1;
      job.timer = setTimeout(() => this.handleTimeout(job), this.jobTimeoutMs);
      job.timer.unref();
      this.queue.push(job);
      this.dispatch();
      this.refreshMetrics();
    });
  }

  dispatch() {
    if (this.closed) return;

    for (const slot of this.workers) {
      if (!this.queue.length) break;
      if (!slot?.ready || slot.busy || slot.retiring) continue;

      const job = this.queue.shift();
      slot.busy = true;
      slot.currentJob = job;
      job.startedAt = process.hrtime.bigint();
      recordGenerationQueueWait(elapsedMs(job.enqueuedAt));
      slot.worker.ref();
      slot.worker.postMessage({
        id: job.id,
        input: job.input,
        options: job.options,
      });
    }
    this.refreshMetrics();
  }

  async close() {
    if (this.closed) return;
    this.closed = true;

    const shutdownError = generationError('Plan generation is shutting down.', {
      status: 503,
      code: 'generation-shutting-down',
    });
    for (const job of this.queue.splice(0)) {
      clearTimeout(job.timer);
      recordGenerationFinished({
        input: job.input,
        outcome: 'shutdown',
        totalMs: elapsedMs(job.enqueuedAt),
      });
      job.reject(shutdownError);
    }

    await Promise.allSettled(this.workers
      .filter(Boolean)
      .map((slot) => slot.worker.terminate()));
    this.workers = [];
    this.refreshMetrics();
  }

  stats() {
    return {
      workers: this.workerCount,
      ready: this.workers.filter((slot) => slot?.ready).length,
      busy: this.workers.filter((slot) => slot?.busy).length,
      queued: this.queue.length,
      maxQueue: this.maxQueue,
    };
  }

  refreshMetrics() {
    setGenerationPoolMetrics(this.stats());
  }
}

const configuredWorkerCount = positiveInteger(
  process.env.GENERATION_WORKER_COUNT,
  defaultWorkerCount(),
);

function createGenerationPool() {
  return new PlanGenerationPool({
    workerCount: configuredWorkerCount,
    maxQueue: positiveInteger(process.env.GENERATION_MAX_QUEUE, configuredWorkerCount * 4),
    jobTimeoutMs: positiveInteger(process.env.GENERATION_TIMEOUT_MS, 15000),
  });
}

// Started at load so workers are warm before the first request. After
// closeGenerationPool() a later call starts a fresh pool instead of failing,
// so one caller's shutdown (e.g. a test file) cannot break the next one.
let generationPool = createGenerationPool();

function currentPool() {
  if (!generationPool) generationPool = createGenerationPool();
  return generationPool;
}

async function generatePlanInWorker(input, options = {}) {
  const { traceEvents, ...workerOptions } = options;
  try {
    const result = await currentPool().run(input, workerOptions);
    if (Array.isArray(traceEvents)) traceEvents.push(...result.traceEvents);
    return result.plan;
  } catch (error) {
    if (Array.isArray(traceEvents) && Array.isArray(error.traceEvents)) {
      traceEvents.push(...error.traceEvents);
    }
    throw error;
  }
}

function closeGenerationPool() {
  const pool = generationPool;
  generationPool = null;
  return pool ? pool.close() : Promise.resolve();
}

function generationPoolStats() {
  return currentPool().stats();
}

module.exports = {
  PlanGenerationPool,
  closeGenerationPool,
  generatePlanInWorker,
  generationPoolStats,
};
