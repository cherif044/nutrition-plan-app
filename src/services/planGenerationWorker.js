const { parentPort } = require('worker_threads');

const { generatePlan, getFoods } = require('./planGenerator');
const { loadReadyMealBundles } = require('../repositories/readyMealRepository');

// Warm the immutable catalogs before this worker accepts generation jobs.
getFoods();
loadReadyMealBundles();

parentPort.on('message', ({ id, input, options = {} }) => {
  const traceEvents = [];

  try {
    const plan = generatePlan(input, {
      ...options,
      traceEvents,
    });
    parentPort.postMessage({
      type: 'result',
      id,
      plan,
      traceEvents,
    });
  } catch (error) {
    parentPort.postMessage({
      type: 'error',
      id,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        status: error.status,
        code: error.code,
      },
      traceEvents,
    });
  }
});

parentPort.postMessage({ type: 'ready' });
