const path = require('path');
const os = require('os');
const { Worker } = require('worker_threads');

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

function generationError(message, { status = 500, code } = {}) {
  return Object.assign(new Error(message), { status, code });
}

function errorFromWorker(payload = {}) {
  const error = generationError(payload.message || 'Plan generation failed.', {
    status: payload.status || 400,
    code: payload.code,
  });
  error.name = payload.name || 'Error';
  if (payload.stack) error.stack = payload.stack;
  return error;
}

class PlanGenerationPool {
  constructor(options = {}) {
    this.workerCount = positiveInteger(options.workerCount, defaultWorkerCount());
    this.maxQueue = positiveInteger(options.maxQueue, this.workerCount * 4);
    this.jobTimeoutMs = positiveInteger(options.jobTimeoutMs, 15000);
    this.workerPath = options.workerPath || path.join(__dirname, 'planGenerationWorker.js');
    this.workers = [];
    this.queue = [];
    this.nextJobId = 1;
    this.closed = false;

    for (let index = 0; index < this.workerCount; index += 1) {
      this.spawnWorker(index);
    }
  }

  spawnWorker(index) {
    if (this.closed) return;

    const worker = new Worker(this.workerPath);
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
      return;
    }

    const job = slot.currentJob;
    if (!job || message?.id !== job.id) return;

    slot.currentJob = null;
    slot.busy = false;
    clearTimeout(job.timer);

    if (message.type === 'result') {
      job.resolve({ plan: message.plan, traceEvents: message.traceEvents || [] });
    } else {
      const error = errorFromWorker(message.error);
      error.traceEvents = message.traceEvents || [];
      job.reject(error);
    }

    slot.worker.unref();
    this.dispatch();
  }

  handleExit(index, slot, code) {
    if (this.workers[index] !== slot) return;

    const job = slot.currentJob;
    if (job) {
      clearTimeout(job.timer);
      job.reject(slot.lastError || generationError(
        `Plan generation worker exited unexpectedly (${code}).`,
        { status: 503, code: 'generation-worker-exited' },
      ));
    }

    this.workers[index] = null;
    if (!this.closed) {
      this.spawnWorker(index);
    }
  }

  handleTimeout(job) {
    const queuedIndex = this.queue.indexOf(job);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      job.reject(generationError('Plan generation queue timed out.', {
        status: 503,
        code: 'generation-queue-timeout',
      }));
      return;
    }

    const slot = this.workers.find((candidate) => candidate?.currentJob === job);
    if (!slot) return;

    slot.currentJob = null;
    slot.busy = false;
    slot.retiring = true;
    job.reject(generationError('Plan generation timed out.', {
      status: 504,
      code: 'generation-timeout',
    }));
    slot.worker.terminate().catch(() => {});
  }

  run(input, options = {}) {
    if (this.closed) {
      return Promise.reject(generationError('Plan generation is shutting down.', {
        status: 503,
        code: 'generation-shutting-down',
      }));
    }

    if (this.queue.length >= this.maxQueue) {
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
      };
      this.nextJobId += 1;
      job.timer = setTimeout(() => this.handleTimeout(job), this.jobTimeoutMs);
      job.timer.unref();
      this.queue.push(job);
      this.dispatch();
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
      slot.worker.ref();
      slot.worker.postMessage({
        id: job.id,
        input: job.input,
        options: job.options,
      });
    }
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
      job.reject(shutdownError);
    }

    await Promise.allSettled(this.workers
      .filter(Boolean)
      .map((slot) => slot.worker.terminate()));
    this.workers = [];
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
}

const configuredWorkerCount = positiveInteger(
  process.env.GENERATION_WORKER_COUNT,
  defaultWorkerCount(),
);

const generationPool = new PlanGenerationPool({
  workerCount: configuredWorkerCount,
  maxQueue: positiveInteger(process.env.GENERATION_MAX_QUEUE, configuredWorkerCount * 4),
  jobTimeoutMs: positiveInteger(process.env.GENERATION_TIMEOUT_MS, 15000),
});

async function generatePlanInWorker(input, options = {}) {
  const { traceEvents, ...workerOptions } = options;
  try {
    const result = await generationPool.run(input, workerOptions);
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
  return generationPool.close();
}

function generationPoolStats() {
  return generationPool.stats();
}

module.exports = {
  PlanGenerationPool,
  closeGenerationPool,
  generatePlanInWorker,
  generationPoolStats,
};
