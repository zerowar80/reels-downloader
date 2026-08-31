const statusBox = document.getElementById('statusBox');
const errorBanner = document.getElementById('errorBanner');

const igForm = document.getElementById('igForm');
const igUsername = document.getElementById('igUsername');
const igPassword = document.getElementById('igPassword');
const saveBtn = document.getElementById('saveBtn');
const disconnectBtn = document.getElementById('disconnectBtn');

const cookieForm = document.getElementById('cookieForm');
const cookieFileInput = document.getElementById('cookieFileInput');
const cookieTextInput = document.getElementById('cookieTextInput');
const cookieSaveBtn = document.getElementById('cookieSaveBtn');
const cookieDisconnectBtn = document.getElementById('cookieDisconnectBtn');

const logoutBtn = document.getElementById('logoutBtn');

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('show');
  setTimeout(() => errorBanner.classList.remove('show'), 4500);
}

async function loadStatus() {
  const res = await fetch('/api/settings/instagram');
  if (res.status === 401) return (location.href = 'login.html');
  const data = await res.json();

  const lines = [];
  if (data.hasCookieFile) {
    lines.push(`<span class="dot ok"></span> 쿠키 파일로 연결되어 있습니다. (2단계 인증 계정도 동작)`);
  }
  if (data.hasCredentials) {
    lines.push(`<span class="dot ${data.hasCookieFile ? 'off' : 'ok'}"></span> <b>${data.username}</b> 아이디/비밀번호가 저장되어 있습니다.${data.hasCookieFile ? ' (지금은 쿠키 파일이 우선 적용됩니다)' : ''}`);
  }
  if (!lines.length) {
    lines.push(`<span class="dot off"></span> 아직 연결된 계정이 없습니다. (로그인 없이도 공개 콘텐츠는 계속 이용 가능합니다)`);
  }

  statusBox.innerHTML = lines.join('<br/>');
  statusBox.classList.add('show');

  disconnectBtn.style.display = data.hasCredentials ? 'block' : 'none';
  if (data.hasCredentials) igUsername.value = data.username;

  cookieDisconnectBtn.style.display = data.hasCookieFile ? 'block' : 'none';
}

igForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  saveBtn.disabled = true;
  saveBtn.textContent = '저장 중...';
  try {
    const res = await fetch('/api/settings/instagram', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: igUsername.value.trim(), password: igPassword.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
    igPassword.value = '';
    await loadStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = '저장하고 연결';
  }
});

disconnectBtn.addEventListener('click', async () => {
  if (!confirm('아이디/비밀번호 연결을 해제할까요?')) return;
  await fetch('/api/settings/instagram', { method: 'DELETE' });
  igUsername.value = '';
  igPassword.value = '';
  await loadStatus();
});

cookieFileInput.addEventListener('change', () => {
  const file = cookieFileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    cookieTextInput.value = reader.result;
  };
  reader.readAsText(file);
});

cookieForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const cookiesText = cookieTextInput.value.trim();
  if (!cookiesText) {
    showError('cookies.txt 파일을 선택하거나 내용을 붙여넣어주세요.');
    return;
  }
  cookieSaveBtn.disabled = true;
  cookieSaveBtn.textContent = '저장 중...';
  try {
    const res = await fetch('/api/settings/instagram/cookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cookiesText })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '저장에 실패했습니다.');
    await loadStatus();
  } catch (err) {
    showError(err.message);
  } finally {
    cookieSaveBtn.disabled = false;
    cookieSaveBtn.textContent = '쿠키 저장';
  }
});

cookieDisconnectBtn.addEventListener('click', async () => {
  if (!confirm('쿠키 연결을 해제할까요?')) return;
  await fetch('/api/settings/instagram/cookies', { method: 'DELETE' });
  cookieFileInput.value = '';
  cookieTextInput.value = '';
  await loadStatus();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = 'login.html';
});

(async function init() {
  const meRes = await fetch('/api/auth/me');
  if (!meRes.ok) return (location.href = 'login.html');
  await loadStatus();
})();
