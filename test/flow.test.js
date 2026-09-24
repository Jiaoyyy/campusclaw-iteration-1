import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).filter(Boolean).map(line => line.split('=')));
const base = process.env.TEST_BASE_URL || `http://127.0.0.1:${env.PORT}`;
const db = process.env.TEST_BASE_URL ? null : new DatabaseSync(path.join(root, 'data/app.db'));

async function login(username, password) {
  const response = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
  assert.equal(response.status, 200);
  return { cookie: response.headers.get('set-cookie').split(';')[0], ...await response.json() };
}
async function call(route, session, options = {}) {
  return fetch(base + route, { ...options, headers: { Cookie: session.cookie, ...(options.headers || {}) } });
}
test('health, login, upload, class isolation, student rejection, logout', async () => {
  assert.equal((await fetch(base + '/health')).status, 200);
  assert.equal((await fetch(base + '/api/materials')).status, 401);
  const wrong = await fetch(`${base}/api/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'teacher-a', password: 'wrong-password' }) });
  assert.equal(wrong.status, 401);
  const aTeacher = await login('teacher-a', env.SEED_TEACHER_A_PASSWORD);
  const aStudent = await login('student-a', env.SEED_STUDENT_A_PASSWORD);
  const bStudent = await login('student-b', env.SEED_STUDENT_B_PASSWORD);
  const before = db?.prepare('SELECT count(*) AS n FROM materials').get().n;

  const file = new FormData();
  file.append('file', new Blob(['# Lesson\nA class only'], { type: 'text/markdown' }), '课堂讲义.md');
  file.append('class_id', 'B');
  const uploaded = await call('/api/materials', aTeacher, { method: 'POST', headers: { 'X-CSRF-Token': aTeacher.csrf }, body: file });
  assert.equal(uploaded.status, 201);
  const { material_id: id } = await uploaded.json();
  if (db) {
    assert.equal(db.prepare('SELECT class_id FROM materials WHERE id=?').get(id).class_id, 'A');
    assert.equal(db.prepare('SELECT class_id FROM knowledge_entries WHERE material_id=?').get(id).class_id, 'A');
    assert.equal(db.prepare('SELECT count(*) AS n FROM materials').get().n, before + 1);
  }

  const aList = await (await call('/api/materials', aStudent)).json();
  assert.ok(aList.some(row => row.id === id));
  assert.equal(aList.find(row => row.id === id).filename, '课堂讲义.md');
  const aSearch = await (await call('/api/materials?q=课堂&class_id=B', aStudent)).json();
  assert.ok(aSearch.some(row => row.id === id));
  const bList = await (await call('/api/materials', bStudent)).json();
  assert.ok(!bList.some(row => row.id === id));
  const bSearch = await (await call('/api/materials?q=课堂&class_id=A', bStudent)).json();
  assert.ok(!bSearch.some(row => row.id === id));
  for (const route of [`/api/materials/${id}`, `/api/materials/${id}/download`]) {
    const denied = await call(route, bStudent);
    assert.equal(denied.status, 404);
    assert.ok(!(await denied.text()).includes('Lesson'));
  }
  const studentUpload = await call('/api/materials', aStudent, { method: 'POST', headers: { 'X-CSRF-Token': aStudent.csrf }, body: file });
  assert.equal(studentUpload.status, 403);
  assert.equal((await call('/api/materials', aTeacher, { method: 'POST', body: file })).status, 403);
  if (db) assert.equal(db.prepare('SELECT count(*) AS n FROM materials').get().n, before + 1);
  assert.equal((await call(`/api/materials/${id}/download`, aStudent)).status, 200);

  const emptyFile = new FormData();
  emptyFile.append('file', new Blob(['']), 'empty.md');
  assert.equal((await call('/api/materials', aTeacher, { method: 'POST', headers: { 'X-CSRF-Token': aTeacher.csrf }, body: emptyFile })).status, 400);
  if (db) assert.equal(db.prepare('SELECT count(*) AS n FROM materials').get().n, before + 1);
  assert.equal((await call('/api/logout', aStudent, { method: 'POST', headers: { 'X-CSRF-Token': aStudent.csrf } })).status, 200);
  assert.equal((await call('/api/materials', aStudent)).status, 401);
});
