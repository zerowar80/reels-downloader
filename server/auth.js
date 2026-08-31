const jwt = require('jsonwebtoken');

const SECRET = process.env.JWT_SECRET || 'please_change_this_secret_in_env';

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: '로그인이 필요합니다.' });
  try {
    req.user = jwt.verify(token, SECRET);
    next();
  } catch (e) {
    return res.status(401).json({ error: '세션이 만료되었습니다. 다시 로그인해주세요.' });
  }
}

function requireAdmin(req, res, next) {
  requireAuth(req, res, () => {
    const db = require('./db');
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(req.user.id);
    if (!user || !user.is_admin) {
      return res.status(403).json({ error: '관리자만 접근할 수 있습니다.' });
    }
    next();
  });
}

function cookieOpts() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    maxAge: 30 * 24 * 60 * 60 * 1000
  };
}

module.exports = { requireAuth, requireAdmin, SECRET, cookieOpts };
