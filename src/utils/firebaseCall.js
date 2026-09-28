const { recordDependencyCall } = require('./metrics');

// Times a Firebase Admin call and records it as a dependency metric.
async function firebaseCall(operation, callback) {
  const startedAt = process.hrtime.bigint();
  const durationMs = () => Number(process.hrtime.bigint() - startedAt) / 1e6;
  try {
    const result = await callback();
    recordDependencyCall({ dependency: 'firebase', operation, outcome: 'success', durationMs: durationMs() });
    return result;
  } catch (error) {
    recordDependencyCall({ dependency: 'firebase', operation, outcome: 'error', durationMs: durationMs() });
    throw error;
  }
}

module.exports = { firebaseCall };
