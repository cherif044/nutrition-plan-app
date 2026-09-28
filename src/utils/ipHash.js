const { createHmac } = require('crypto');

// Client IPs are personal data. Logs and session rows store a keyed hash
// instead: equal IPs still group together, but the raw address cannot be
// read back. The log hash rotates daily so it cannot follow a person across
// days; the session hash is stable so one session can be compared over time.

function hashKey() {
  return process.env.IP_HASH_SECRET || process.env.JWT_SECRET || 'pincherize-dev-ip-hash';
}

function hmac(key, value) {
  return createHmac('sha256', key).update(String(value)).digest('base64url');
}

function hashIp(ip, { daily = true, now = new Date() } = {}) {
  if (!ip) return null;
  const key = daily ? hmac(hashKey(), now.toISOString().slice(0, 10)) : hashKey();
  return hmac(key, ip).slice(0, 16);
}

module.exports = { hashIp };
