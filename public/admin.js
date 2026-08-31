const statsRow = document.getElementById('statsRow');
const userTableBody = document.getElementById('userTableBody');
const errorBanner = document.getElementById('errorBanner');
const logoutBtn = document.getElementById('logoutBtn');

function fmtSize(bytes) {
  if (!bytes) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('show');
  setTimeout(() => errorBanner.classList.remove('show'), 4000);
}

async function loadStats() {
  const res = await fetch('/api/admin/stats');
  if (!res.ok) return;
  const s = await res.json();
  statsRow.innerHTML = `
    <div class="stat-card"><div class="stat-num">${s.totalUsers}</div><div class="stat-label">전체 사용자</div></div>
    <div class="stat-card"><div class="stat-num">${s.totalDownloads}</div><div class="stat-label">전체 다운로드</div></div>
    <div class="stat-card"><div class="stat-num">${fmtSize(s.totalStorageBytes)}</div><div class="stat-label">전체 사용 용량</div></div>
  `;
}

async function loadUsers() {
  const res = await fetch('/api/admin/users');
  if (res.status === 403) {
    showError('관리자만 접근할 수 있습니다.');
    setTimeout(() => (location.href = 'index.html'), 1500);
    return;
  }
  if (res.status === 401) return (location.href = 'login.html');
  const users = await res.json();

  userTableBody.innerHTML = users
    .map(
      (u) => `
      <tr>
        <td>${u.username}</td>
        <td>${u.isAdmin ? '<span class="badge done" style="position:static;">관리자</span>' : '일반'}</td>
        <td>${u.downloadCount}</td>
        <td>${fmtSize(u.storageBytes)}</td>
        <td>${(u.createdAt || '').slice(0, 10)}</td>
        <td>
          ${
            u.isAdmin
              ? ''
              : `<button class="btn btn-ghost" style="width:auto;padding:6px 10px;font-size:12px;" onclick="deleteUser(${u.id}, '${u.username}')">삭제</button>`
          }
        </td>
      </tr>`
    )
    .join('');
}

window.deleteUser = async (id, username) => {
  if (!confirm(`${username} 계정을 삭제할까요? 해당 사용자의 다운로드 파일도 모두 삭제됩니다.`)) return;
  const res = await fetch(`/api/admin/users/${id}`, { method: 'DELETE' });
  const data = await res.json();
  if (!res.ok) return showError(data.error || '삭제에 실패했습니다.');
  await loadUsers();
  await loadStats();
};

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = 'login.html';
});

(async function init() {
  const meRes = await fetch('/api/auth/me');
  if (!meRes.ok) return (location.href = 'login.html');
  const me = await meRes.json();
  if (!me.isAdmin) {
    showError('관리자만 접근할 수 있습니다.');
    setTimeout(() => (location.href = 'index.html'), 1200);
    return;
  }
  await loadStats();
  await loadUsers();
})();
