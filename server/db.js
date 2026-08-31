const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new Database(path.join(DATA_DIR, 'app.db'));
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT,
    thumbnail TEXT,
    filename TEXT,
    filesize INTEGER,
    quality TEXT DEFAULT 'best',
    kind TEXT DEFAULT 'video',
    status TEXT DEFAULT 'pending',
    error TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS instagram_accounts (
    user_id INTEGER PRIMARY KEY,
    ig_username TEXT NOT NULL,
    ig_password_enc TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY(user_id) REFERENCES users(id)
  );
`);

// 기존 DB(구버전)에 새 컬럼이 없을 수 있으므로 안전하게 추가 시도
function ensureColumn(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
ensureColumn('users', 'is_admin', 'INTEGER DEFAULT 0');
ensureColumn('downloads', 'quality', "TEXT DEFAULT 'best'");
ensureColumn('downloads', 'kind', "TEXT DEFAULT 'video'");

// 관리자가 한 명도 없으면 가장 먼저 가입한 사용자를 자동으로 관리자로 승격
const adminExists = db.prepare('SELECT id FROM users WHERE is_admin = 1 LIMIT 1').get();
if (!adminExists) {
  const first = db.prepare('SELECT id FROM users ORDER BY id ASC LIMIT 1').get();
  if (first) db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(first.id);
}

module.exports = db;
