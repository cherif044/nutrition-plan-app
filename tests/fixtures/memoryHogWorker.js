// Test worker speaking the plan-generation pool protocol. A job with
// { hog: true } allocates until the worker's heap limit kills it.
const { parentPort } = require('worker_threads');

parentPort.on('message', ({ id, input }) => {
  if (input?.hog) {
    const hoard = [];
    for (;;) hoard.push(new Array(1e6).fill(Math.random()));
  }
  parentPort.postMessage({ type: 'result', id, plan: { ok: true, meals: [] }, traceEvents: [] });
});

parentPort.postMessage({ type: 'ready' });
