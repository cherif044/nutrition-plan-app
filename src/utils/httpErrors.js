// Errors caused by the request itself. Anything thrown without a status is
// treated as a server fault (500, message hidden in production).
function inputError(message, extra = {}) {
  return Object.assign(new Error(message), { status: 400, expose: true, ...extra });
}

module.exports = { inputError };
