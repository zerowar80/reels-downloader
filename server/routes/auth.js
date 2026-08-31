const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db');
const { SECRET, cookieOpts } = require('../auth');

const router = express.Router();

function registrationAllowed() {
  return process.env.ALLOW_REGISTRATION !== 'false';
}

router.get('/config', (req, res) => {
  res.json({ allowRegistration: registrationAllowed() });
});

router.post('/register', (req, res) => {
  if (!registrationAllowed()) {
    return res.status(403).json({ error: '현재 회원가입이 비활성화되어 있습니다.' });
  }
  const { username, password } = req.body || {};
  if (!username || !password || password.length < 6) {
    return res.status(400).json({ error: '아이디와 6자 이상의 비밀번호를 입력해주세요.' });
  }
  const exists = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (exists) return res.status(409).json({ error: '이미 존재하는 아이디입니다.' });

  const hash = bcrypt.hashSync(password, 10);
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  const isFirstUser = userCount === 0;

  const info = db
    .prepare('INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, ?)')
    .run(username, hash, isFirstUser ? 1 : 0);

  const token = jwt.sign(
    { id: info.lastInsertRowid, username, isAdmin: isFirstUser },
    SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('token', token, cookieOpts());
  res.json({ ok: true, username, isAdmin: isFirstUser });
});

router.post('/login', (req, res) => {
  const { username, password } = req.body || {};
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' });
  }
  const isAdmin = !!user.is_admin;
  const token = jwt.sign(
    { id: user.id, username: user.username, isAdmin },
    SECRET,
    { expiresIn: '30d' }
  );
  res.cookie('token', token, cookieOpts());
  res.json({ ok: true, username: user.username, isAdmin });
});

router.post('/logout', (req, res) => {
  res.clearCookie('token');
  res.json({ ok: true });
});

router.get('/me', (req, res) => {
  const token = req.cookies && req.cookies.token;
  if (!token) return res.status(401).json({ error: 'not logged in' });
  try {
    const payload = jwt.verify(token, SECRET);
    // DB 기준 최신 관리자 상태로 재확인 (토큰 발급 이후 승격/강등될 수 있으므로)
    const user = db.prepare('SELECT is_admin FROM users WHERE id = ?').get(payload.id);
    res.json({ username: payload.username, isAdmin: !!(user && user.is_admin) });
  } catch {
    res.status(401).json({ error: 'invalid session' });
  }
});

module.exports = router;
