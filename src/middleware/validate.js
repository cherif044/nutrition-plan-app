// Rejects a request before any handler runs when its body or query string
// does not match the schema. A validated body replaces req.body, so handlers
// only ever see trimmed, bounded values.

function firstIssueMessage(error) {
  const issue = error.issues[0];
  if (!issue) return 'Invalid request.';
  // Messages written for users end with a period; generic zod messages get
  // the field path so the cause is still clear.
  if (/[.!?]$/.test(issue.message)) return issue.message;
  const path = issue.path.join('.');
  return path ? `Invalid ${path}: ${issue.message}` : issue.message;
}

function reject(req, res, error) {
  return res.status(400).json({
    error: firstIssueMessage(error),
    field: error.issues[0]?.path.join('.') || undefined,
    requestId: req.id,
  });
}

function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) return reject(req, res, result.error);
    req.body = result.data;
    return next();
  };
}

function validateQuery(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.query ?? {});
    if (!result.success) return reject(req, res, result.error);
    return next();
  };
}

// Route ids are bigint primary keys. Anything else cannot match a row, so it
// is answered as "not found" without touching the database.
function validateIdParam(req, res, next, id) {
  if (/^\d{1,18}$/.test(String(id))) return next();
  return res.status(404).json({ error: 'Not found.', requestId: req.id });
}

module.exports = { validateBody, validateIdParam, validateQuery };
