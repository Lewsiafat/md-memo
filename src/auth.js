import crypto from 'node:crypto';

// Optional HTTP Basic Auth — gated by AUTH_ENABLED (default off). See CLAUDE.md.
// Only the password is checked; the username is ignored.

// Pure: does this Authorization header carry the expected password?
// Compares fixed-length sha256 digests via timingSafeEqual to avoid timing side channels.
export function checkPassword(authHeader, expected) {
  if (!expected) return false;
  const [scheme, encoded] = (authHeader || '').split(' ');
  if (scheme !== 'Basic' || !encoded) return false;
  const decoded = Buffer.from(encoded, 'base64').toString('utf8');
  const password = decoded.slice(decoded.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(password).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

// Factory: returns Express middleware. Pass-through when disabled or misconfigured
// (enabled without a password) so a half-set config never locks everyone out.
export function createAuth({ enabled, password, publicPrefix }) {
  if (!enabled) return (req, res, next) => next();
  if (!password) {
    console.warn('[auth] AUTH_ENABLED=true but AUTH_PASSWORD is empty — protection disabled');
    return (req, res, next) => next();
  }
  return (req, res, next) => {
    if (publicPrefix && req.path.startsWith(publicPrefix)) return next();
    if (checkPassword(req.headers.authorization, password)) return next();
    res.set('WWW-Authenticate', 'Basic realm="md-memo", charset="UTF-8"');
    res.status(401).send('Authentication required');
  };
}
