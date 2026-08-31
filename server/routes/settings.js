const express = require('express');
const db = require('../db');
const { requireAuth } = require('../auth');
const {
  encrypt,
  clearCookiesFor,
  hasUploadedCookies,
  saveUploadedCookies,
  clearUploadedCookies
} = require('../instagram-auth');

const router = express.Router();
router.use(requireAuth);

// 연결 상태 조회 (아이디/비번 로그인 여부 + 업로드 쿠키 여부 둘 다 알려줌)
router.get('/instagram', (req, res) => {
  const row = db
    .prepare('SELECT ig_username, updated_at FROM instagram_accounts WHERE user_id = ?')
    .get(req.user.id);

  res.json({
    hasCredentials: !!(row && row.ig_username),
    username: row ? row.ig_username : null,
    updatedAt: row ? row.updated_at : null,
    hasCookieFile: hasUploadedCookies(req.user.id)
  });
});

// 아이디/비밀번호 로그인 등록 (2FA 없는 계정용)
router.post('/instagram', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: '인스타그램 아이디와 비밀번호를 입력해주세요.' });
  }

  const enc = encrypt(password);
  db.prepare(
    `INSERT INTO instagram_accounts (user_id, ig_username, ig_password_enc, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(user_id) DO UPDATE SET
       ig_username = excluded.ig_username,
       ig_password_enc = excluded.ig_password_enc,
       updated_at = excluded.updated_at`
  ).run(req.user.id, username, enc);

  // 계정 정보가 바뀌었으니 기존에 캐시된 로그인 세션은 폐기 (다음 요청 때 새로 로그인)
  clearCookiesFor(req.user.id);

  res.json({ ok: true, username });
});

// 아이디/비밀번호 로그인 해제
router.delete('/instagram', (req, res) => {
  db.prepare('DELETE FROM instagram_accounts WHERE user_id = ?').run(req.user.id);
  clearCookiesFor(req.user.id);
  res.json({ ok: true });
});

// 쿠키 파일 업로드 (2FA 계정용). 브라우저에서 export한 cookies.txt(Netscape 형식) 내용을 그대로 받음
router.post('/instagram/cookies', (req, res) => {
  const { cookiesText } = req.body || {};
  if (!cookiesText || typeof cookiesText !== 'string' || cookiesText.trim().length < 10) {
    return res.status(400).json({ error: '올바른 cookies.txt 내용을 붙여넣거나 업로드해주세요.' });
  }
  // 아주 기본적인 형식 검증 (Netscape 쿠키 파일은 보통 이 헤더로 시작)
  const looksValid =
    cookiesText.includes('.instagram.com') ||
    cookiesText.trim().startsWith('# Netscape') ||
    cookiesText.trim().startsWith('# HTTP Cookie File');
  if (!looksValid) {
    return res.status(400).json({
      error: '인스타그램 쿠키 파일처럼 보이지 않습니다. instagram.com 도메인 쿠키가 포함된 파일인지 확인해주세요.'
    });
  }

  saveUploadedCookies(req.user.id, cookiesText);
  res.json({ ok: true });
});

// 업로드한 쿠키 파일 삭제
router.delete('/instagram/cookies', (req, res) => {
  clearUploadedCookies(req.user.id);
  res.json({ ok: true });
});

module.exports = router;
