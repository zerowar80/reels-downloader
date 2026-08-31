const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../db');
const { requireAdmin } = require('../auth');

const router = express.Router();
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || path.join(__dirname, '..', '..', 'downloads');

router.use(requireAdmin);

// 사용자 목록 + 각자 다운로드 개수/용량
router.get('/users', (req, res) => {
  const users = db.prepare('SELECT id, username, is_admin, created_at FROM users').all();
  const rows = users.map((u) => {
    const stat = db
      .prepare(
        'SELECT COUNT(*) AS count, COALESCE(SUM(filesize), 0) AS bytes FROM downloads WHERE user_id = ?'
      )
      .get(u.id);
    return {
      id: u.id,
      username: u.username,
      isAdmin: !!u.is_admin,
      createdAt: u.created_at,
      downloadCount: stat.count,
      storageBytes: stat.bytes
    };
  });
  res.json(rows);
});

// 전체 통계
router.get('/stats', (req, res) => {
  const totals = db
    .prepare('SELECT COUNT(*) AS count, COALESCE(SUM(filesize), 0) AS bytes FROM downloads')
    .get();
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
  res.json({
    totalUsers: userCount,
    totalDownloads: totals.count,
    totalStorageBytes: totals.bytes
  });
});

// 사용자 삭제 (파일 포함)
router.delete('/users/:id', (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '본인 계정은 삭제할 수 없습니다.' });
  }
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(targetId);
  if (!target) return res.status(404).json({ error: '사용자를 찾을 수 없습니다.' });

  db.prepare('DELETE FROM downloads WHERE user_id = ?').run(targetId);
  db.prepare('DELETE FROM users WHERE id = ?').run(targetId);

  const userDir = path.join(DOWNLOAD_DIR, String(targetId));
  if (fs.existsSync(userDir)) {
    fs.rmSync(userDir, { recursive: true, force: true });
  }

  res.json({ ok: true });
});

// 관리자 권한 부여/해제
router.patch('/users/:id/admin', (req, res) => {
  const targetId = Number(req.params.id);
  const { isAdmin } = req.body || {};
  if (targetId === req.user.id) {
    return res.status(400).json({ error: '본인 계정의 권한은 여기서 변경할 수 없습니다.' });
  }
  db.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(isAdmin ? 1 : 0, targetId);
  res.json({ ok: true });
});

module.exports = router;
