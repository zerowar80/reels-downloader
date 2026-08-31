const express = require('express');
const { spawn, execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const db = require('../db');
const { requireAuth } = require('../auth');
const { getInstagramAuthArgs } = require('../instagram-auth');

const router = express.Router();
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '..', 'downloads');

router.use(requireAuth);

// quality 값 -> yt-dlp 인자 매핑 (userId에 연결된 인스타그램 로그인 정보를 함께 사용)
function buildYtdlpArgs(url, outTemplate, quality, userId) {
  const common = ['-o', outTemplate, '--no-warnings', ...getInstagramAuthArgs(userId)];

  if (quality === 'audio') {
    return [...common, '-x', '--audio-format', 'mp3', url];
  }

  if (quality === 'best' || !quality) {
    return [
      ...common,
      '-f', 'bestvideo+bestaudio/best',
      '--merge-output-format', 'mp4',
      url
    ];
  }

  // '1080', '720', '480', '360' 등 숫자 높이 기준
  const height = parseInt(quality, 10);
  if (!Number.isNaN(height)) {
    return [
      ...common,
      '-f', `bestvideo[height<=${height}]+bestaudio/best[height<=${height}]`,
      '--merge-output-format', 'mp4',
      url
    ];
  }

  // 알 수 없는 값이면 최고 화질로 폴백
  return [...common, '-f', 'bestvideo+bestaudio/best', '--merge-output-format', 'mp4', url];
}

// 링크의 사용 가능한 화질 목록 조회 (다운로드 전 미리보기용)
router.post('/probe', (req, res) => {
  const { url } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: '올바른 URL을 입력해주세요.' });
  }

  execFile(
    'yt-dlp',
    ['-j', '--no-warnings', ...getInstagramAuthArgs(req.user.id), url],
    { maxBuffer: 1024 * 1024 * 20, timeout: 30000 },
    (err, stdout) => {
      if (err) return res.status(422).json({ error: '이 링크의 정보를 가져올 수 없습니다.' });
      let meta;
      try {
        meta = JSON.parse(stdout);
      } catch {
        return res.status(422).json({ error: '이 링크의 정보를 가져올 수 없습니다.' });
      }

      const heights = new Set();
      (meta.formats || []).forEach((f) => {
        if (f.height) heights.add(f.height);
      });
      const availableHeights = Array.from(heights).sort((a, b) => b - a);

      res.json({
        title: meta.title || '제목 없음',
        thumbnail: meta.thumbnail || '',
        duration: meta.duration || null,
        availableHeights
      });
    }
  );
});

// 내 다운로드 목록 (검색 + 정렬 지원)
router.get('/', (req, res) => {
  const { q, sort } = req.query;
  let rows = db
    .prepare('SELECT * FROM downloads WHERE user_id = ?')
    .all(req.user.id);

  if (q && q.trim()) {
    const needle = q.trim().toLowerCase();
    rows = rows.filter((r) => (r.title || '').toLowerCase().includes(needle));
  }

  switch (sort) {
    case 'old':
      rows.sort((a, b) => a.id - b.id);
      break;
    case 'name':
      rows.sort((a, b) => (a.title || '').localeCompare(b.title || '', 'ko'));
      break;
    case 'size':
      rows.sort((a, b) => (b.filesize || 0) - (a.filesize || 0));
      break;
    case 'new':
    default:
      rows.sort((a, b) => b.id - a.id);
  }

  res.json(rows);
});

// 새 다운로드 요청 (단건 또는 여러 건 일괄)
router.post('/', (req, res) => {
  const { url, urls, quality } = req.body || {};
  const list = Array.isArray(urls) && urls.length ? urls : url ? [url] : [];
  const cleaned = list.map((u) => String(u || '').trim()).filter((u) => /^https?:\/\//i.test(u));

  if (!cleaned.length) {
    return res.status(400).json({ error: '올바른 URL을 최소 1개 입력해주세요.' });
  }

  const userDir = path.join(DOWNLOAD_DIR, String(req.user.id));
  fs.mkdirSync(userDir, { recursive: true });

  const kind = quality === 'audio' ? 'audio' : 'video';
  const createdIds = [];

  cleaned.forEach((oneUrl) => {
    const info = db
      .prepare(
        'INSERT INTO downloads (user_id, source_url, title, status, quality, kind) VALUES (?, ?, ?, ?, ?, ?)'
      )
      .run(req.user.id, oneUrl, '가져오는 중...', 'downloading', quality || 'best', kind);
    const id = info.lastInsertRowid;
    createdIds.push(id);
    runDownloadJob(id, oneUrl, userDir, quality, req.user.id);
  });

  res.json({ ok: true, ids: createdIds });
});

// 프로필(계정) 링크 하나로 그 계정의 릴스 등을 여러 개 한 번에 수집해서 다운로드
router.post('/collect', (req, res) => {
  const { profileUrl, quality } = req.body || {};
  let limit = parseInt(req.body && req.body.limit, 10);
  if (Number.isNaN(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 200); // 과도한 대량 수집 방지

  if (!profileUrl || !/^https?:\/\//i.test(profileUrl)) {
    return res.status(400).json({ error: '올바른 프로필(계정) URL을 입력해주세요.' });
  }

  const userDir = path.join(DOWNLOAD_DIR, String(req.user.id));
  fs.mkdirSync(userDir, { recursive: true });

  // --flat-playlist: 각 영상을 전부 열어보지 않고 목록만 빠르게 가져옴
  execFile(
    'yt-dlp',
    [
      '--flat-playlist',
      '--playlist-end', String(limit),
      '-J',
      '--no-warnings',
      ...getInstagramAuthArgs(req.user.id),
      profileUrl
    ],
    { maxBuffer: 1024 * 1024 * 40, timeout: 60000 },
    (err, stdout) => {
      if (err) {
        return res.status(422).json({
          error:
            '프로필의 릴스 목록을 가져오지 못했습니다. 비공개 계정이거나 로그인이 필요한 상태일 수 있습니다. 설정 페이지에서 인스타그램 계정을 연결해보세요.'
        });
      }

      let data;
      try {
        data = JSON.parse(stdout);
      } catch {
        return res.status(422).json({ error: '목록을 해석하지 못했습니다.' });
      }

      const entries = Array.isArray(data.entries) ? data.entries : [];
      if (!entries.length) {
        return res.status(422).json({ error: '이 프로필에서 가져올 수 있는 항목이 없습니다.' });
      }

      const urls = entries
        .map((e) => {
          if (e.url && /^https?:\/\//i.test(e.url)) return e.url;
          if (e.webpage_url) return e.webpage_url;
          if (e.id) return `https://www.instagram.com/reel/${e.id}/`;
          return null;
        })
        .filter(Boolean)
        .slice(0, limit);

      if (!urls.length) {
        return res.status(422).json({ error: '가져올 수 있는 링크를 찾지 못했습니다.' });
      }

      const kind = quality === 'audio' ? 'audio' : 'video';
      const createdIds = [];

      urls.forEach((oneUrl) => {
        const info = db
          .prepare(
            'INSERT INTO downloads (user_id, source_url, title, status, quality, kind) VALUES (?, ?, ?, ?, ?, ?)'
          )
          .run(req.user.id, oneUrl, '가져오는 중...', 'downloading', quality || 'best', kind);
        const id = info.lastInsertRowid;
        createdIds.push(id);
        runDownloadJob(id, oneUrl, userDir, quality, req.user.id);
      });

      res.json({ ok: true, count: createdIds.length, ids: createdIds });
    }
  );
});

function runDownloadJob(id, url, userDir, quality, userId) {
  execFile(
    'yt-dlp',
    ['-j', '--no-warnings', ...getInstagramAuthArgs(userId), url],
    { maxBuffer: 1024 * 1024 * 20, timeout: 30000 },
    (err, stdout) => {
      let title = '영상';
      let thumbnail = '';
      if (!err) {
        try {
          const meta = JSON.parse(stdout);
          title = meta.title || title;
          thumbnail = meta.thumbnail || '';
        } catch {
          /* ignore */
        }
      }
      db.prepare('UPDATE downloads SET title = ?, thumbnail = ? WHERE id = ?').run(
        title,
        thumbnail,
        id
      );

      const outTemplate = path.join(userDir, `${id}.%(ext)s`);
      const args = buildYtdlpArgs(url, outTemplate, quality, userId);
      const proc = spawn('yt-dlp', args);

      let stderrBuf = '';
      proc.stderr.on('data', (d) => {
        stderrBuf += d.toString();
        if (stderrBuf.length > 4000) stderrBuf = stderrBuf.slice(-4000);
      });

      proc.on('close', (code) => {
        if (code === 0) {
          const files = fs.readdirSync(userDir).filter((f) => f.startsWith(`${id}.`));
          const filename = files[0] || null;
          const filesize = filename
            ? fs.statSync(path.join(userDir, filename)).size
            : null;
          db.prepare(
            'UPDATE downloads SET status = ?, filename = ?, filesize = ? WHERE id = ?'
          ).run(filename ? 'done' : 'error', filename, filesize, id);
        } else {
          db.prepare('UPDATE downloads SET status = ?, error = ? WHERE id = ?').run(
            'error',
            stderrBuf.slice(-500) || '다운로드 실패',
            id
          );
        }
      });
    }
  );
}

// 파일 저장(첨부 다운로드)
router.get('/:id/file', (req, res) => {
  const row = db
    .prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row || !row.filename) return res.status(404).json({ error: '파일을 찾을 수 없습니다.' });
  const filePath = path.join(DOWNLOAD_DIR, String(req.user.id), row.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: '파일이 존재하지 않습니다.' });
  res.download(filePath, row.filename);
});

// 인앱 재생용 스트리밍 (Range 요청 지원)
router.get('/:id/stream', (req, res) => {
  const row = db
    .prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row || !row.filename) return res.status(404).end();
  const filePath = path.join(DOWNLOAD_DIR, String(req.user.id), row.filename);
  if (!fs.existsSync(filePath)) return res.status(404).end();

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  const ext = path.extname(filePath).toLowerCase();
  const contentType = ext === '.mp3' ? 'audio/mpeg' : 'video/mp4';

  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': contentType
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes'
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// 삭제
router.delete('/:id', (req, res) => {
  const row = db
    .prepare('SELECT * FROM downloads WHERE id = ? AND user_id = ?')
    .get(req.params.id, req.user.id);
  if (!row) return res.status(404).json({ error: 'not found' });
  if (row.filename) {
    const filePath = path.join(DOWNLOAD_DIR, String(req.user.id), row.filename);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }
  db.prepare('DELETE FROM downloads WHERE id = ?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
