import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const passwords = {
  SEED_TEACHER_A_PASSWORD: 'temporary-A-teacher-pass',
  SEED_STUDENT_A_PASSWORD: 'temporary-A-student-pass',
  SEED_TEACHER_B_PASSWORD: 'temporary-B-teacher-pass',
  SEED_STUDENT_B_PASSWORD: 'temporary-B-student-pass'
};
function startServer(dir) {
  const child = spawn(process.execPath, [path.join(root, 'server.js')], {
    env: { ...process.env, ...passwords, DB_PATH: path.join(dir, 'app.db'), UPLOAD_DIR: path.join(dir, 'uploads'), PORT: '0' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  return new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => { child.kill(); reject(new Error(`startup timeout: ${output}`)); }, 10000);
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/localhost:(\d+)/);
      if (match) { clearTimeout(timeout); resolve({ child, base: `http://127.0.0.1:${match[1]}` }); }
    });
    child.stderr.on('data', data => { output += data; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); if (!output.includes('localhost:')) reject(new Error(`server exited ${code}: ${output}`)); });
  });
}
async function stopServer(child) {
  child.kill('SIGTERM');
  if (child.exitCode === null) await new Promise(resolve => child.once('exit', resolve));
}
test('upload failures leave no DB rows or files; crash orphan is quarantined', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'campusclaw-test-'));
  let server;
  try {
    server = await startServer(dir);
    const login = await fetch(server.base + '/api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'teacher-a', password: passwords.SEED_TEACHER_A_PASSWORD })
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const { csrf } = await login.json();
    const headers = { Cookie: cookie, 'X-CSRF-Token': csrf };
    async function upload(name, bytes) {
      const form = new FormData();
      form.append('file', new Blob([bytes]), name);
      return fetch(server.base + '/api/materials', { method: 'POST', headers, body: form });
    }
    assert.equal((await upload('too-big.md', Buffer.alloc(2 * 1024 * 1024 + 1, 65))).status, 413);
    assert.equal((await upload('bad.md', Buffer.from([0xff, 0xfe]))).status, 400);
    const db = new DatabaseSync(path.join(dir, 'app.db'));
    db.exec("CREATE TRIGGER fail_knowledge BEFORE INSERT ON knowledge_entries BEGIN SELECT RAISE(ABORT, 'forced'); END;");
    assert.equal((await upload('valid.md', '# valid')).status, 503);
    assert.equal(db.prepare('SELECT count(*) AS n FROM materials').get().n, 0);
    assert.equal(db.prepare('SELECT count(*) AS n FROM knowledge_entries').get().n, 0);
    assert.equal(fs.readdirSync(path.join(dir, 'uploads')).length, 0);
    db.exec('DROP TRIGGER fail_knowledge');
    db.prepare('UPDATE sessions SET expires_at=0').run();
    assert.equal((await fetch(server.base + '/api/materials', { headers: { Cookie: cookie } })).status, 401);
    db.close();

    await stopServer(server.child);
    const orphanName = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa.md';
    fs.writeFileSync(path.join(dir, 'uploads', orphanName), 'interrupted upload');
    server = await startServer(dir);
    assert.ok(!fs.existsSync(path.join(dir, 'uploads', orphanName)));
    assert.equal(fs.readdirSync(path.join(dir, 'uploads', '.orphaned')).length, 1);
    assert.equal((await fetch(server.base + '/health')).status, 200);
  } finally {
    if (server?.child.exitCode === null) await stopServer(server.child);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
