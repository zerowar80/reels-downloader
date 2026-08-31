const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const form = document.getElementById('downloadForm');
const urlInput = document.getElementById('urlInput');
const profileFields = document.getElementById('profileFields');
const profileUrlInput = document.getElementById('profileUrlInput');
const limitSelect = document.getElementById('limitSelect');
const modeTabs = document.querySelectorAll('.mode-tab');
const qualitySelect = document.getElementById('qualitySelect');
const downloadBtn = document.getElementById('downloadBtn');
const errorBanner = document.getElementById('errorBanner');
const logoutBtn = document.getElementById('logoutBtn');
const searchInput = document.getElementById('searchInput');
const sortSelect = document.getElementById('sortSelect');
const adminLink = document.getElementById('adminLink');

const playerOverlay = document.getElementById('playerOverlay');
const playerVideo = document.getElementById('playerVideo');
const playerAudio = document.getElementById('playerAudio');
const playerClose = document.getElementById('playerClose');

let items = [];
let pollTimer = null;
let searchDebounce = null;
let mode = 'links';

modeTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    mode = tab.dataset.mode;
    modeTabs.forEach((t) => t.classList.toggle('active', t === tab));
    if (mode === 'profile') {
      urlInput.style.display = 'none';
      urlInput.required = false;
      profileFields.style.display = 'block';
      profileUrlInput.required = true;
      limitSelect.style.display = 'inline-block';
      downloadBtn.textContent = '전체 수집';
    } else {
      urlInput.style.display = 'block';
      urlInput.required = true;
      profileFields.style.display = 'none';
      profileUrlInput.required = false;
      limitSelect.style.display = 'none';
      downloadBtn.textContent = '다운로드';
    }
  });
});

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.add('show');
  setTimeout(() => errorBanner.classList.remove('show'), 4000);
}

function statusLabel(status) {
  if (status === 'done') return '완료';
  if (status === 'downloading') return '다운로드 중';
  if (status === 'error') return '오류';
  return status;
}

function fmtSize(bytes) {
  if (!bytes) return '';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${(bytes / 1024).toFixed(0)} KB`;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function render() {
  if (!items.length) {
    grid.innerHTML = '';
    emptyState.style.display = 'block';
    return;
  }
  emptyState.style.display = 'none';

  grid.innerHTML = items
    .map((it) => {
      const isAudio = it.kind === 'audio';
      const thumb = it.thumbnail
        ? `<img src="${it.thumbnail}" alt="" loading="lazy" />`
        : `<span>${isAudio ? '🎵 오디오' : '미리보기 없음'}</span>`;

      const playOverlay =
        it.status === 'done'
          ? `<button class="play-btn" onclick="playItem(${it.id}, '${isAudio ? 'audio' : 'video'}')" aria-label="재생">▶</button>`
          : '';

      const actions =
        it.status === 'done'
          ? `<a class="btn btn-primary" href="/api/downloads/${it.id}/file" style="text-decoration:none;text-align:center;">저장</a>
             <button class="btn btn-ghost" onclick="removeItem(${it.id})">삭제</button>`
          : it.status === 'error'
          ? `<button class="btn btn-ghost" style="flex:1;" disabled>실패</button>
             <button class="btn btn-ghost" onclick="removeItem(${it.id})">삭제</button>`
          : `<button class="btn btn-primary" disabled>처리 중...</button>`;

      const qualityBadge = isAudio ? 'MP3' : it.quality === 'best' ? '최고화질' : `${it.quality}p`;

      return `
        <div class="card">
          <div class="thumb">
            ${thumb}
            ${playOverlay}
            <span class="badge ${it.status}">${statusLabel(it.status)}</span>
            <span class="badge quality-badge">${qualityBadge}</span>
          </div>
          <div class="card-body">
            <div class="card-title">${escapeHtml(it.title || '제목 없음')}</div>
            <div class="card-meta">${it.filesize ? fmtSize(it.filesize) : ''}</div>
            <div class="card-actions">${actions}</div>
          </div>
        </div>`;
    })
    .join('');
}

async function loadItems() {
  const params = new URLSearchParams();
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  if (sortSelect.value) params.set('sort', sortSelect.value);

  const res = await fetch(`/api/downloads?${params.toString()}`);
  if (res.status === 401) return (location.href = 'login.html');
  items = await res.json();
  render();

  const hasPending = items.some((i) => i.status === 'downloading');
  if (hasPending && !pollTimer) {
    pollTimer = setInterval(loadItems, 2500);
  } else if (!hasPending && pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  downloadBtn.disabled = true;

  if (mode === 'profile') {
    const profileUrl = profileUrlInput.value.trim();
    if (!profileUrl) {
      downloadBtn.disabled = false;
      return;
    }
    downloadBtn.textContent = '수집 중...';
    try {
      const res = await fetch('/api/downloads/collect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          profileUrl,
          quality: qualitySelect.value,
          limit: Number(limitSelect.value)
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || '수집에 실패했습니다.');
      profileUrlInput.value = '';
      await loadItems();
    } catch (err) {
      showError(err.message);
    } finally {
      downloadBtn.disabled = false;
      downloadBtn.textContent = '전체 수집';
    }
    return;
  }

  const rawUrls = urlInput.value
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rawUrls.length) {
    downloadBtn.disabled = false;
    return;
  }

  downloadBtn.textContent = '요청 중...';
  try {
    const res = await fetch('/api/downloads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ urls: rawUrls, quality: qualitySelect.value })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '요청에 실패했습니다.');
    urlInput.value = '';
    await loadItems();
  } catch (err) {
    showError(err.message);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.textContent = '다운로드';
  }
});

searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(loadItems, 300);
});
sortSelect.addEventListener('change', loadItems);

window.removeItem = async (id) => {
  if (!confirm('이 항목을 삭제할까요?')) return;
  await fetch(`/api/downloads/${id}`, { method: 'DELETE' });
  await loadItems();
};

window.playItem = (id, kind) => {
  playerOverlay.classList.add('show');
  if (kind === 'audio') {
    playerVideo.style.display = 'none';
    playerVideo.pause();
    playerVideo.src = '';
    playerAudio.style.display = 'block';
    playerAudio.src = `/api/downloads/${id}/stream`;
  } else {
    playerAudio.style.display = 'none';
    playerAudio.pause();
    playerAudio.src = '';
    playerVideo.style.display = 'block';
    playerVideo.src = `/api/downloads/${id}/stream`;
  }
};

function closePlayer() {
  playerOverlay.classList.remove('show');
  playerVideo.pause();
  playerVideo.src = '';
  playerAudio.pause();
  playerAudio.src = '';
}
playerClose.addEventListener('click', closePlayer);
playerOverlay.addEventListener('click', (e) => {
  if (e.target === playerOverlay) closePlayer();
});

logoutBtn.addEventListener('click', async () => {
  await fetch('/api/auth/logout', { method: 'POST' });
  location.href = 'login.html';
});

(async function init() {
  const meRes = await fetch('/api/auth/me');
  if (!meRes.ok) return (location.href = 'login.html');
  const me = await meRes.json();
  document.getElementById('usernameLabel').textContent = me.username;
  document.getElementById('avatarInitial').textContent = me.username[0].toUpperCase();
  if (me.isAdmin) adminLink.style.display = 'inline-flex';
  await loadItems();
})();
