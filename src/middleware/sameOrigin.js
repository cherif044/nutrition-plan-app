// CSRF defense for cookie-authenticated requests. Browsers always attach an
// Origin (or at least a Referer) to cross-site POST/PUT/PATCH/DELETE requests,
// so a state-changing request whose source is another site is rejected.
// Requests with neither header come from non-browser clients, which cannot
// ride on a victim's cookies, so they are left to normal authentication.

const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function allowedExtraOrigins() {
  return String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function sourceOrigin(req) {
  const source = req.get('origin') || req.get('referer');
  if (!source) return null;
  try {
    return new URL(source);
  } catch {
    return undefined;
  }
}

function sameOriginOnly(req, res, next) {
  if (!UNSAFE_METHODS.has(req.method)) return next();

  const source = sourceOrigin(req);
  if (source === null) return next();
  if (source && source.hostname === req.hostname) return next();
  if (source && allowedExtraOrigins().includes(source.origin)) return next();

  return res.status(403).json({
    error: 'Cross-site request blocked.',
    requestId: req.id,
  });
}

module.exports = { sameOriginOnly };
