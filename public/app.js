const $ = selector => document.querySelector(selector);
let me = null;
const escapeHtml = value => String(value).replace(/[&<>"']/g, x => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[x]);
function renderMarkdown(raw) {
  // Escape all HTML first: uploaded Markdown cannot create scripts, tags, or links.
  return raw.split(/\r?\n/).map(line => {
    const text = escapeHtml(line).replace(/`([^`]+)`/g, '<code>$1</code>');
    const heading = text.match(/^(#{1,3})\s+(.+)$/);
    if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
    return `<p>${text || '&nbsp;'}</p>`;
  }).join('');
}
async function api(url, options = {}) {
  const response = await fetch(url, { credentials: 'same-origin', ...options });
  const contentType = response.headers.get('content-type') || '';
  const result = contentType.includes('application/json') ? await response.json() : null;
  if (!response.ok) throw new Error(result?.error || `请求失败 (${response.status})`);
  return result;
}
function showWorkspace() {
  $('#login-panel').hidden = true;
  $('#workspace').hidden = false;
  $('#logout').hidden = false;
  $('#welcome').textContent = `${me.class_id} 班，${me.role === 'teacher' ? '教师' : '学生'}你好`;
  $('#role-note').textContent = `${me.username} · 这里只显示你所在班级的讲义`;
  $('#upload-panel').hidden = me.role !== 'teacher';
}
async function loadMaterials() {
  const rows = await api('/api/materials?q=' + encodeURIComponent($('#search').value));
  const container = $('#materials');
  container.replaceChildren();
  if (!rows.length) { container.textContent = '暂无讲义'; return; }
  for (const item of rows) {
    const button = document.createElement('button');
    button.className = 'card';
    const title = document.createElement('strong'); title.textContent = item.title;
    const detail = document.createElement('small'); detail.textContent = `${item.filename} · ${new Date(item.created_at).toLocaleString()}`;
    button.append(title, detail);
    button.onclick = () => openMaterial(item.id);
    container.append(button);
  }
}
async function openMaterial(id) {
  const item = await api(`/api/materials/${id}`);
  $('#detail-title').textContent = item.title;
  $('#detail-body').innerHTML = item.filename.toLowerCase().endsWith('.md') ? renderMarkdown(item.body_text) : `<p>${escapeHtml(item.body_text)}</p>`;
  $('#download').href = `/api/materials/${id}/download`;
  $('#detail').hidden = false;
  $('#detail').scrollIntoView({ behavior: 'smooth' });
}
$('#login-form').onsubmit = async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  const form = new FormData(event.currentTarget);
  try {
    me = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) });
    showWorkspace(); await loadMaterials();
  } catch (error) { $('#login-error').textContent = error.message; }
};
$('#upload-form').onsubmit = async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = $('#upload-message'); status.textContent = '上传中…';
  try {
    await api('/api/materials', { method: 'POST', headers: { 'X-CSRF-Token': me.csrf }, body: new FormData(form) });
    form.reset(); status.textContent = '上传成功'; await loadMaterials();
  } catch (error) { status.textContent = error.message; }
};
$('#logout').onclick = async () => { await api('/api/logout', { method: 'POST', headers: { 'X-CSRF-Token': me.csrf } }); location.reload(); };
$('#search').oninput = () => loadMaterials().catch(error => $('#materials').textContent = error.message);
$('#back').onclick = () => { $('#detail').hidden = true; $('#materials').scrollIntoView({ behavior: 'smooth' }); };
$('#view-toggle').onclick = () => { const grid = $('#materials').classList.toggle('grid'); localStorage.setItem('cc-grid', String(grid)); };
$('#theme').onclick = () => { const dark = document.body.classList.toggle('dark'); localStorage.setItem('cc-dark', String(dark)); };
document.body.classList.toggle('dark', localStorage.getItem('cc-dark') === 'true');
$('#materials').classList.toggle('grid', localStorage.getItem('cc-grid') === 'true');
api('/api/me').then(user => { me = user; showWorkspace(); return loadMaterials(); }).catch(() => {});
