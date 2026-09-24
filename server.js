import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
function loadEnv() {
  const file = path.join(root, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2];
  }
}
loadEnv();
const port = Number(process.env.PORT || 8080);
const dbPath = path.resolve(root, process.env.DB_PATH || './data/app.db');
const uploadDir = path.resolve(root, process.env.UPLOAD_DIR || './uploads');
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
fs.mkdirSync(uploadDir, { recursive: true });
const db = new DatabaseSync(dbPath);
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('teacher','student')), class_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id),
  csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS materials (
  id INTEGER PRIMARY KEY, class_id TEXT NOT NULL, title TEXT NOT NULL,
  filename TEXT NOT NULL, stored_name TEXT NOT NULL UNIQUE,
  uploaded_by INTEGER NOT NULL REFERENCES users(id), created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS knowledge_entries (
  id INTEGER PRIMARY KEY, material_id INTEGER NOT NULL UNIQUE REFERENCES materials(id),
  class_id TEXT NOT NULL, body_text TEXT NOT NULL
);`);

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`;
}
function verifyPassword(password, stored) {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const actual = crypto.scryptSync(password, Buffer.from(saltHex, 'hex'), 64);
  const expected = Buffer.from(hashHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
const seed = [
  ['teacher-a', 'teacher', 'A', 'SEED_TEACHER_A_PASSWORD'],
  ['student-a', 'student', 'A', 'SEED_STUDENT_A_PASSWORD'],
  ['teacher-b', 'teacher', 'B', 'SEED_TEACHER_B_PASSWORD'],
  ['student-b', 'student', 'B', 'SEED_STUDENT_B_PASSWORD']
];
for (const [username, role, classId, envName] of seed) {
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) continue;
  const password = process.env[envName];
  if (!password || password.length < 12) {
    throw new Error(`Set ${envName} to at least 12 characters before first start`);
  }
  db.prepare('INSERT INTO users(username,password_hash,role,class_id) VALUES(?,?,?,?)')
    .run(username, hashPassword(password), role, classId);
}

// A process can stop after saving a file but before committing its DB rows.
// Keep such files recoverable while removing them from the active upload area.
const recordedFiles = new Set(db.prepare('SELECT stored_name FROM materials').all().map(row => row.stored_name));
for (const entry of fs.readdirSync(uploadDir, { withFileTypes: true })) {
  if (!entry.isFile() || !/^[a-f0-9-]{36}\.(txt|md)$/.test(entry.name) || recordedFiles.has(entry.name)) continue;
  const orphanDir = path.join(uploadDir, '.orphaned');
  fs.mkdirSync(orphanDir, { recursive: true });
  fs.renameSync(path.join(uploadDir, entry.name), path.join(orphanDir, `${entry.name}.${Date.now()}`));
}

function json(res, status, value, headers = {}) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function fail(res, status, message) { json(res, status, { error: message }); }
function page(res, name) {
  const file = path.join(publicDir, name);
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': name.endsWith('.css') ? 'text/css; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8', 'Content-Length': body.length, 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function cookies(req) {
  return Object.fromEntries((req.headers.cookie || '').split(';').map(s => s.trim().split('=').slice(0, 2)).filter(x => x.length === 2));
}
function currentUser(req) {
  const token = cookies(req).cc_session;
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return null;
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const row = db.prepare(`SELECT u.id,u.username,u.role,u.class_id,s.csrf
    FROM sessions s JOIN users u ON u.id=s.user_id
    WHERE s.token_hash=? AND s.expires_at>?`).get(tokenHash, Date.now());
  return row ? { ...row, tokenHash } : null;
}
async function readBody(req, max = 2 * 1024 * 1024 + 16384) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > max) { const e = new Error('too large'); e.status = 413; throw e; }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
function csrfOk(req, user) { return user && req.headers['x-csrf-token'] === user.csrf; }
function safeFileName(name) {
  const base = path.basename(name.replaceAll('\\', '/'));
  return base.length > 0 && base.length <= 200 && !/[\u0000-\u001f]/.test(base) ? base : null;
}
function parseMultipart(buffer, contentType) {
  const match = contentType.match(/^multipart\/form-data;\s*boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) return null;
  const boundary = Buffer.from('--' + (match[1] || match[2]));
  const first = buffer.indexOf(boundary);
  if (first !== 0) return null;
  const parts = [];
  let cursor = boundary.length;
  while (true) {
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() !== '\r\n') return null;
    const headerEnd = buffer.indexOf('\r\n\r\n', cursor + 2);
    if (headerEnd < 0) return null;
    const next = buffer.indexOf(Buffer.concat([Buffer.from('\r\n'), boundary]), headerEnd + 4);
    if (next < 0) return null;
    const headers = buffer.subarray(cursor + 2, headerEnd).toString('latin1');
    const field = headers.match(/content-disposition:\s*form-data;\s*name="([^"]+)"(?:;\s*filename="([^"]*)")?/i);
    if (field) parts.push({
      name: field[1],
      filename: field[2] === undefined ? undefined : Buffer.from(field[2], 'latin1').toString('utf8'),
      data: buffer.subarray(headerEnd + 4, next)
    });
    cursor = next + 2 + boundary.length;
  }
  return parts;
}
function materialFor(user, id) {
  return db.prepare(`SELECT m.id,m.class_id,m.title,m.filename,m.stored_name,m.created_at,k.body_text
    FROM materials m JOIN knowledge_entries k ON k.material_id=m.id
    WHERE m.id=? AND m.class_id=?`).get(id, user.class_id);
}
function handle(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const method = req.method;
  if (method === 'GET' && url.pathname === '/health') return json(res, 200, { status: 'ok' });
  if (method === 'GET' && (url.pathname === '/login' || url.pathname === '/')) return page(res, 'index.html');
  if (method === 'GET' && url.pathname === '/style.css') return page(res, 'style.css');
  if (method === 'GET' && url.pathname === '/app.js') return page(res, 'app.js');
  if (method === 'POST' && url.pathname === '/api/login') return login(req, res);
  const user = currentUser(req);
  if (!user) return fail(res, 401, '请先登录');
  if (method === 'GET' && url.pathname === '/api/me') return json(res, 200, { username: user.username, role: user.role, class_id: user.class_id, csrf: user.csrf });
  if (method === 'POST' && url.pathname === '/api/logout') {
    if (!csrfOk(req, user)) return fail(res, 403, '请求验证失败');
    db.prepare('DELETE FROM sessions WHERE token_hash=?').run(user.tokenHash);
    return json(res, 200, { ok: true }, { 'Set-Cookie': 'cc_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0' });
  }
  if (method === 'GET' && url.pathname === '/api/materials') {
    const q = (url.searchParams.get('q') || '').slice(0, 100).toLowerCase();
    const rows = db.prepare('SELECT id,title,filename,created_at FROM materials WHERE class_id=? ORDER BY id DESC').all(user.class_id);
    return json(res, 200, rows.filter(x => x.title.toLowerCase().includes(q)));
  }
  if (method === 'POST' && url.pathname === '/api/materials') return upload(req, res, user);
  const matched = url.pathname.match(/^\/api\/materials\/(\d+)(\/download)?$/);
  if (method === 'GET' && matched) {
    const material = materialFor(user, Number(matched[1]));
    if (!material) return fail(res, 404, '未找到');
    if (!matched[2]) return json(res, 200, { id: material.id, title: material.title, filename: material.filename, body_text: material.body_text, created_at: material.created_at });
    const target = path.join(uploadDir, material.stored_name);
    if (!fs.existsSync(target)) return fail(res, 503, '文件暂不可用');
    const data = fs.readFileSync(target);
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(material.filename)}`, 'Content-Length': data.length, 'X-Content-Type-Options': 'nosniff' });
    return res.end(data);
  }
  return fail(res, 404, '未找到');
}
async function login(req, res) {
  const raw = await readBody(req, 8192);
  let input;
  try { input = JSON.parse(raw.toString('utf8')); } catch { return fail(res, 400, '请求格式错误'); }
  const username = String(input.username || '');
  const password = String(input.password || '');
  const row = db.prepare('SELECT * FROM users WHERE username=?').get(username);
  if (!row || !verifyPassword(password, row.password_hash)) return fail(res, 401, '账号或密码错误');
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const csrf = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO sessions(token_hash,user_id,csrf,expires_at) VALUES(?,?,?,?)')
    .run(tokenHash, row.id, csrf, Date.now() + 8 * 60 * 60 * 1000);
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  return json(res, 200, { username: row.username, role: row.role, class_id: row.class_id, csrf }, {
    'Set-Cookie': `cc_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800${secure}`
  });
}
async function upload(req, res, user) {
  if (user.role !== 'teacher') return fail(res, 403, '只有教师可以上传');
  if (!csrfOk(req, user)) return fail(res, 403, '请求验证失败');
  const raw = await readBody(req);
  const parts = parseMultipart(raw, req.headers['content-type'] || '');
  const file = parts?.find(x => x.name === 'file');
  const filename = file && safeFileName(file.filename || '');
  if (!filename || !/\.(txt|md)$/i.test(filename) || !file.data.length) return fail(res, 400, '请上传非空的 txt 或 md 文件');
  if (file.data.length > 2 * 1024 * 1024) return fail(res, 413, '文件超过 2 MiB');
  let body;
  try { body = new TextDecoder('utf-8', { fatal: true }).decode(file.data); } catch { return fail(res, 400, '文件须为 UTF-8'); }
  if (!body.trim()) return fail(res, 400, '文件内容为空');
  const stored = crypto.randomUUID() + path.extname(filename).toLowerCase();
  const target = path.join(uploadDir, stored);
  try {
    fs.writeFileSync(target, file.data, { flag: 'wx', mode: 0o600 });
    db.exec('BEGIN IMMEDIATE');
    try {
      const result = db.prepare('INSERT INTO materials(class_id,title,filename,stored_name,uploaded_by,created_at) VALUES(?,?,?,?,?,?)')
        .run(user.class_id, filename.replace(/\.(txt|md)$/i, ''), filename, stored, user.id, new Date().toISOString());
      db.prepare('INSERT INTO knowledge_entries(material_id,class_id,body_text) VALUES(?,?,?)').run(result.lastInsertRowid, user.class_id, body);
      db.exec('COMMIT');
      return json(res, 201, { material_id: Number(result.lastInsertRowid) });
    } catch (error) { db.exec('ROLLBACK'); throw error; }
  } catch (error) {
    try { fs.unlinkSync(target); } catch { /* file may not have been created */ }
    throw error;
  }
}
const server = http.createServer((req, res) => {
  Promise.resolve().then(() => handle(req, res)).catch(error => {
    if (res.headersSent) return res.end();
    if (error.status === 413) return fail(res, 413, '请求过大');
    console.error('Request failed:', error.message);
    return fail(res, 503, '服务暂不可用');
  });
});
server.listen(port, '0.0.0.0', () => console.log(`CampusClaw on http://localhost:${server.address().port}`));
