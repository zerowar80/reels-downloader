const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const db = require('./db');

// 비밀번호 암호화용 키. CRED_ENC_KEY를 별도로 지정하지 않으면 JWT_SECRET을 재사용합니다.
// (둘 다 반드시 docker-compose.yml에서 랜덤한 값으로 바꿔주세요)
const RAW_KEY = process.env.CRED_ENC_KEY || process.env.JWT_SECRET || 'insecure_default_key';
const ENC_KEY = crypto.scryptSync(RAW_KEY, 'reels-downloader-cred-salt', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', ENC_KEY, iv);
  const enc = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

function decrypt(payload) {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', ENC_KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');

// 아이디/비번 로그인 시 세션을 캐싱해두는 파일 (자동 생성/갱신됨)
function cookiesPathFor(userId) {
  return path.join(DATA_DIR, `ig_cookies_${userId}.txt`);
}

function clearCookiesFor(userId) {
  const p = cookiesPathFor(userId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// 사용자가 브라우저에서 직접 내보내 업로드한 쿠키 파일 (2FA 계정용, 수동 관리)
function uploadedCookiesPathFor(userId) {
  return path.join(DATA_DIR, `ig_uploaded_cookies_${userId}.txt`);
}

function hasUploadedCookies(userId) {
  return fs.existsSync(uploadedCookiesPathFor(userId));
}

function saveUploadedCookies(userId, cookiesText) {
  fs.writeFileSync(uploadedCookiesPathFor(userId), cookiesText, 'utf8');
}

function clearUploadedCookies(userId) {
  const p = uploadedCookiesPathFor(userId);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

// 이 사용자에 대해 yt-dlp에 넘겨줄 로그인 관련 인자를 만들어줌
// 우선순위: 1) 업로드한 쿠키 파일 (2FA 계정도 동작) 2) 아이디/비번 로그인 3) 전역 쿠키 파일 4) 로그인 없음
function getInstagramAuthArgs(userId) {
  // 1) 수동으로 업로드해둔 쿠키 파일이 있으면 최우선 사용 (2단계 인증 계정은 이 방식을 씀)
  if (hasUploadedCookies(userId)) {
    return ['--cookies', uploadedCookiesPathFor(userId)];
  }

  // 2) 아이디/비번을 등록해뒀다면 yt-dlp가 직접 로그인 시도 (2FA 없는 계정만 가능)
  const row = db
    .prepare('SELECT ig_username, ig_password_enc FROM instagram_accounts WHERE user_id = ?')
    .get(userId);

  if (row && row.ig_username && row.ig_password_enc) {
    try {
      const password = decrypt(row.ig_password_enc);
      return [
        '--username', row.ig_username,
        '--password', password,
        '--cookies', cookiesPathFor(userId)
      ];
    } catch {
      // 복호화 실패(예: 비밀 키가 바뀜) 시 그냥 로그인 없이 진행
    }
  }

  // 3) 컨테이너 전체 공용 쿠키 파일 (구버전 방식, 계속 지원)
  const globalCookies = process.env.INSTAGRAM_COOKIES_FILE || '';
  if (globalCookies && fs.existsSync(globalCookies)) {
    return ['--cookies', globalCookies];
  }

  // 4) 아무 것도 없으면 로그인 없이 진행 (공개 계정은 이대로도 대부분 동작)
  return [];
}

module.exports = {
  encrypt,
  decrypt,
  getInstagramAuthArgs,
  cookiesPathFor,
  clearCookiesFor,
  uploadedCookiesPathFor,
  hasUploadedCookies,
  saveUploadedCookies,
  clearUploadedCookies
};
