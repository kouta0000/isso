if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('SW registered'))
      .catch(err => console.log('SW failed', err));
  });
}

const FS_SUPPORTED = typeof window.showSaveFilePicker === 'function';
let fsFileHandle = null;

async function saveViaFSAPI(content, name, ext) {
  try {
    if (!fsFileHandle) {
      fsFileHandle = await window.showSaveFilePicker({
        suggestedName: name + '.' + ext,
        types: [{
          description: ext === 'md' ? 'Markdown file' : 'Text file',
          accept: ext === 'md'
            ? { 'text/markdown': ['.md'] }
            : { 'text/plain':   ['.txt'] },
        }],
      });
    }
    const writable = await fsFileHandle.createWritable();
    await writable.write(content);
    await writable.close();
    return { ok: true, fileName: fsFileHandle.name };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, aborted: true };
    console.error('FS API error:', e);
    return { ok: false, error: e };
  }
}

async function openViaFSAPI() {
  try {
    const [handle] = await window.showOpenFilePicker({
      types: [{
        description: 'テキストファイル',
        accept: { 'text/*': ['.md', '.txt'] },
      }],
      multiple: false,
    });
    const file = await handle.getFile();
    const text = await file.text();
    fsFileHandle = handle;
    return { ok: true, name: file.name, text };
  } catch (e) {
    if (e.name === 'AbortError') return { ok: false, aborted: true };
    return { ok: false, error: e };
  }
}

function downloadFile(content, name, ext) {
  const mime = ext === 'md' ? 'text/markdown' : 'text/plain';
  const blob = new Blob([content], { type: mime + ';charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = name + '.' + ext;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ────────────────────────────────────────────────────
   LOCALSTORAGE ENGINE
──────────────────────────────────────────────────── */
const LS_FILES     = 'sz_files';
const LS_CUR       = 'sz_cur';
const LS_FRONTMATTER = 'sz_frontmatter';  // フロントマター設定
const LS_TEMPLATES   = 'sz_templates';   // テンプレート一覧

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

function lsLoad() {
  try { return JSON.parse(localStorage.getItem(LS_FILES) || '[]'); }
  catch { return []; }
}
function lsSave(arr) {
  try { localStorage.setItem(LS_FILES, JSON.stringify(arr)); return true; }
  catch (e) { console.warn('localStorage error', e); return false; }
}
function lsCurGet() { return localStorage.getItem(LS_CUR) || null; }
function lsCurSet(id) { localStorage.setItem(LS_CUR, id); }

/* ── フロントマター設定 ── */
function fmLoad() {
  try {
    return JSON.parse(localStorage.getItem(LS_FRONTMATTER) || 'null') || {
      enabled: false,
      fields: [
        { key: 'title',  value: '', enabled: true },
        { key: 'date',   value: '{{today}}', enabled: true },
        { key: 'author', value: '', enabled: false },
        { key: 'tags',   value: '', enabled: false },
        { key: 'draft',  value: 'true', enabled: false },
      ]
    };
  } catch { return { enabled: false, fields: [] }; }
}
function fmSave(obj) {
  try { localStorage.setItem(LS_FRONTMATTER, JSON.stringify(obj)); } catch {}
}

/* ── テンプレート ── */
function tmLoad() {
  try {
    return JSON.parse(localStorage.getItem(LS_TEMPLATES) || 'null') || defaultTemplates();
  } catch { return defaultTemplates(); }
}
function tmSave(arr) {
  try { localStorage.setItem(LS_TEMPLATES, JSON.stringify(arr)); } catch {}
}
function defaultTemplates() {
  return [
    {
      id: 'tpl-blog',
      name: 'ブログ記事',
      icon: '✍️',
      ext: 'md',
      content: `# タイトル

## はじめに

ここに導入文を書きます。

## 本文

## まとめ
`,
    },
    {
      id: 'tpl-note',
      name: 'メモ',
      icon: '📝',
      ext: 'md',
      content: `# メモ

**日時**: {{today}}

---

`,
    },
    {
      id: 'tpl-blank',
      name: '空白',
      icon: '◻️',
      ext: 'md',
      content: '',
    },
  ];
}

function dbCreate(name, content, ext = 'md') {
  const files = lsLoad();
  const rec = { id: genId(), name, ext, content, createdAt: Date.now(), updatedAt: Date.now() };
  files.unshift(rec);
  lsSave(files);
  lsCurSet(rec.id);
  return rec;
}
function dbUpdate(id, patch) {
  const files = lsLoad();
  const i = files.findIndex(f => f.id === id);
  if (i < 0) return null;
  files[i] = { ...files[i], ...patch, updatedAt: Date.now() };
  lsSave(files);
  return files[i];
}
function dbDelete(id) {
  const files = lsLoad().filter(f => f.id !== id);
  lsSave(files);
  return files;
}
function dbGet(id) { return lsLoad().find(f => f.id === id) || null; }

/* ────────────────────────────────────────────────────
   FRONTMATTER BUILDER
──────────────────────────────────────────────────── */
function todayStr() {
  const d = new Date();
  return d.getFullYear() + '-' +
    String(d.getMonth()+1).padStart(2,'0') + '-' +
    String(d.getDate()).padStart(2,'0');
}

function buildFrontmatter(fm) {
  if (!fm.enabled) return '';
  const activeFields = fm.fields.filter(f => f.enabled && f.key.trim());
  if (activeFields.length === 0) return '';
  const lines = activeFields.map(f => {
    let v = f.value.replace('{{today}}', todayStr());
    // arrayっぽいフィールド（tags等）
    if (f.key === 'tags' && v.includes(',')) {
      const items = v.split(',').map(s => s.trim()).filter(Boolean);
      return `${f.key}:\n${items.map(t => '  - ' + t).join('\n')}`;
    }
    return `${f.key}: ${v}`;
  });
  return '---\n' + lines.join('\n') + '\n---\n\n';
}

/* ────────────────────────────────────────────────────
   MARKDOWN RENDERER
──────────────────────────────────────────────────── */
function renderMd(src) {
  const E = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // strip frontmatter for preview
  let clean = src.replace(/^---\n[\s\S]*?\n---\n?/, '');

  const blocks = [], inlines = [];
  let t = clean
    .replace(/```([\w]*)\n?([\s\S]*?)```/g, (_,lang,code) => {
      blocks.push(`<pre><code>${E(code.trim())}</code></pre>`);
      return `\x02B${blocks.length-1}\x03`;
    })
    .replace(/`([^`\n]+)`/g, (_,c) => {
      inlines.push(`<code>${E(c)}</code>`);
      return `\x02I${inlines.length-1}\x03`;
    });

  t = E(t);
  t = t
    .replace(/^#{6} (.+)$/gm,'<h6>$1</h6>')
    .replace(/^#{5} (.+)$/gm,'<h5>$1</h5>')
    .replace(/^#{4} (.+)$/gm,'<h4>$1</h4>')
    .replace(/^#{3} (.+)$/gm,'<h3>$1</h3>')
    .replace(/^#{2} (.+)$/gm,'<h2>$1</h2>')
    .replace(/^#{1} (.+)$/gm,'<h1>$1</h1>')
    .replace(/^[-*_]{3,}\s*$/gm,'<hr>')
    .replace(/^&gt;\s?(.+)$/gm,'<blockquote>$1</blockquote>')
    .replace(/\*\*\*(.+?)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g,'<em>$1</em>')
    .replace(/__(.+?)__/g,'<strong>$1</strong>')
    .replace(/_([^_\n]+)_/g,'<em>$1</em>')
    .replace(/~~(.+?)~~/g,'<del>$1</del>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,'<img src="$2" alt="$1" loading="lazy">')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1</a>');

  const rows = t.split('\n');
  const out = []; let ul=false, ol=false;
  for (const row of rows) {
    if (/^\s*[-*+] /.test(row)) {
      if (!ul){if(ol){out.push('</ol>');ol=false;}out.push('<ul>');ul=true;}
      out.push('<li>'+row.replace(/^\s*[-*+] /,'')+'</li>');
    } else if (/^\s*\d+\. /.test(row)) {
      if (!ol){if(ul){out.push('</ul>');ul=false;}out.push('<ol>');ol=true;}
      out.push('<li>'+row.replace(/^\s*\d+\. /,'')+'</li>');
    } else {
      if(ul){out.push('</ul>');ul=false;}
      if(ol){out.push('</ol>');ol=false;}
      out.push(row);
    }
  }
  if(ul)out.push('</ul>'); if(ol)out.push('</ol>');
  t = out.join('\n');

  t = t.split(/\n{2,}/).map(b => {
    b = b.trim(); if(!b) return '';
    if(/^<(h[1-6]|ul|ol|pre|blockquote|hr|div|table)/.test(b)) return b;
    if(/^\x02/.test(b)) return b;
    return '<p>'+b.replace(/\n/g,'<br>')+'</p>';
  }).join('\n');

  t = t.replace(/\x02B(\d+)\x03/g,(_,i)=>blocks[+i]);
  t = t.replace(/\x02I(\d+)\x03/g,(_,i)=>inlines[+i]);
  return t;
}

/* ────────────────────────────────────────────────────
   DOM
──────────────────────────────────────────────────── */
const $  = id => document.getElementById(id);
const editor      = $('editor');
const filename    = $('filename');
const fileExt     = $('file-ext');
const dotUnsaved  = $('dot-unsaved');
const stChars     = $('st-chars');
const stLines     = $('st-lines');
const stMsg       = $('st-msg');
const previewWrap = $('preview-wrap');
const previewBody = $('preview-body');
const sidebar     = $('sidebar');
const sbOverlay   = $('sb-overlay');
const fileList    = $('file-list');
const sbEmpty     = $('sb-empty');
const shareModal  = $('share-modal');
const toastEl     = $('toast');
const fileInput   = $('file-input');

/* ────────────────────────────────────────────────────
   STATE
──────────────────────────────────────────────────── */
const S = {
  id:        null,
  ext:       'md',
  modified:  false,
  preview:   false,
  focus:     false,
};

/* ────────────────────────────────────────────────────
   TOAST
──────────────────────────────────────────────────── */
let toastT;
function toast(msg, ms = 2200) {
  clearTimeout(toastT);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastT = setTimeout(() => toastEl.classList.remove('show'), ms);
}

/* ────────────────────────────────────────────────────
   STATS
──────────────────────────────────────────────────── */
function updateStats() {
  const v = editor.value;
  stChars.textContent = v.length.toLocaleString('ja') + ' 文字';
  stLines.textContent = (v === '' ? 1 : v.split('\n').length).toLocaleString('ja') + ' 行';
}

function setModified(v) {
  S.modified = v;
  dotUnsaved.classList.toggle('on', v);
}

/* ────────────────────────────────────────────────────
   AUTO-SAVE
──────────────────────────────────────────────────── */
let asTimer;
function scheduleAutoSave() {
  clearTimeout(asTimer);
  asTimer = setTimeout(() => {
    const name = filename.value.trim() || 'untitled';
    const content = editor.value;
    if (!S.id) {
      const rec = dbCreate(name, content, S.ext);
      S.id = rec.id;
    } else {
      dbUpdate(S.id, { name, content, ext: S.ext });
    }
    setModified(false);
    stMsg.textContent = '自動保存';
    setTimeout(() => { stMsg.textContent = ''; }, 1800);
    renderFileList();
    lsCurSet(S.id);
  }, 800);
}

/* ────────────────────────────────────────────────────
   MANUAL SAVE
──────────────────────────────────────────────────── */
async function manualSave() {
  clearTimeout(asTimer);
  const name    = filename.value.trim() || 'untitled';
  const content = editor.value;
  const ext     = S.ext;

  if (!S.id) {
    const rec = dbCreate(name, content, ext);
    S.id = rec.id;
  } else {
    dbUpdate(S.id, { name, content, ext });
  }
  setModified(false);
  renderFileList();
  lsCurSet(S.id);

  if (FS_SUPPORTED) {
    stMsg.textContent = '保存中…';
    const res = await saveViaFSAPI(content, name, ext);
    if (res.ok) {
      toast('💾 ' + res.fileName + ' を保存しました');
      stMsg.textContent = '保存しました';
    } else if (!res.aborted) {
      downloadFile(content, name, ext);
      toast('⬇ ' + name + '.' + ext + ' をダウンロードしました');
      stMsg.textContent = 'ダウンロード完了';
    } else {
      stMsg.textContent = '';
      return;
    }
  } else {
    downloadFile(content, name, ext);
    toast('⬇ ' + name + '.' + ext + ' をダウンロードしました');
    stMsg.textContent = 'ダウンロード完了';
  }
  setTimeout(() => { stMsg.textContent = ''; }, 2500);
}

/* ────────────────────────────────────────────────────
   OPEN FILE
──────────────────────────────────────────────────── */
async function openFile() {
  if (S.modified && !confirm('変更が保存されていません。続けますか？')) return;

  if (FS_SUPPORTED) {
    const res = await openViaFSAPI();
    if (!res.ok) return;
    const rawName = res.name.replace(/\.(md|txt)$/i, '');
    const ext = res.name.endsWith('.txt') ? 'txt' : 'md';
    loadIntoEditor({ id: null, name: rawName, content: res.text, ext });
    const rec = dbCreate(rawName, res.text, ext);
    S.id = rec.id;
    lsCurSet(S.id);
    renderFileList();
    toast('📄 ' + res.name + ' を開きました');
  } else {
    fileInput.click();
  }
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const rawName = file.name.replace(/\.(md|txt)$/i, '');
    const ext = file.name.endsWith('.txt') ? 'txt' : 'md';
    loadIntoEditor({ id: null, name: rawName, content: e.target.result, ext });
    const rec = dbCreate(rawName, e.target.result, ext);
    S.id = rec.id;
    lsCurSet(S.id);
    renderFileList();
    toast('📄 ' + file.name + ' を開きました');
  };
  reader.readAsText(file, 'UTF-8');
  fileInput.value = '';
});

/* ────────────────────────────────────────────────────
   LOAD INTO EDITOR
──────────────────────────────────────────────────── */
function loadIntoEditor(rec) {
  fsFileHandle = null;
  S.id  = rec.id;
  S.ext = rec.ext || 'md';
  editor.value      = rec.content || '';
  filename.value    = rec.name   || 'untitled';
  fileExt.textContent = '.' + S.ext;
  setModified(false);
  setFmt(S.ext, false);
  updateStats();
  resizeFn();
  if (S.preview) renderPreview();
  if (rec.id) lsCurSet(rec.id);
}

/* ────────────────────────────────────────────────────
   NEW FILE — テンプレート選択モーダルを開く
──────────────────────────────────────────────────── */
function newFile() {
  if (S.modified && !confirm('変更が保存されていません。新規作成しますか？')) return;
  openNewFileModal();
}

function createFileFromTemplate(tpl) {
  clearTimeout(asTimer);
  fsFileHandle = null;
  const fm = fmLoad();
  const fm_str = buildFrontmatter(fm);
  let content = fm_str + (tpl.content || '');
  const ext = tpl.ext || S.ext;
  const name = tpl.id === 'tpl-blank' ? 'untitled' : tpl.name;
  const rec = dbCreate(name, content, ext);
  loadIntoEditor(rec);
  renderFileList();
  closeSidebar();
  closeNewFileModal();
  editor.focus();
  // カーソルをフロントマターの後ろへ
  const pos = fm_str.length;
  editor.setSelectionRange(pos, pos);
}

/* ════════════════════════════════════════════════════
   NEW FILE MODAL
════════════════════════════════════════════════════ */
function openNewFileModal() {
  const modal = $('new-file-modal');
  modal.classList.remove('hidden');
  renderNewFileModal();
}
function closeNewFileModal() {
  $('new-file-modal').classList.add('hidden');
}

function renderNewFileModal() {
  const templates = tmLoad();
  const fm = fmLoad();

  const tplGrid = $('nf-tpl-grid');
  tplGrid.innerHTML = '';
  templates.forEach(tpl => {
    const btn = document.createElement('button');
    btn.className = 'nf-tpl-btn';
    btn.innerHTML = `<span class="nf-tpl-icon">${esc(tpl.icon||'📄')}</span><span class="nf-tpl-name">${esc(tpl.name)}</span>`;
    btn.addEventListener('click', () => createFileFromTemplate(tpl));
    tplGrid.appendChild(btn);
  });

  // フロントマタートグル
  const toggle = $('nf-fm-toggle');
  toggle.checked = fm.enabled;

  // フロントマターフィールドリスト
  renderFmFields(fm);
}

function renderFmFields(fm) {
  const container = $('nf-fm-fields');
  container.innerHTML = '';

  fm.fields.forEach((field, i) => {
    const row = document.createElement('div');
    row.className = 'fm-row';
    row.innerHTML = `
      <label class="fm-check-wrap">
        <input type="checkbox" class="fm-check" data-idx="${i}" ${field.enabled ? 'checked' : ''}>
      </label>
      <input class="fm-key" type="text" value="${esc(field.key)}" data-idx="${i}" placeholder="key" maxlength="32">
      <span class="fm-sep">:</span>
      <input class="fm-val" type="text" value="${esc(field.value)}" data-idx="${i}" placeholder="value">
      <button class="fm-del" data-idx="${i}" title="削除">✕</button>
    `;
    container.appendChild(row);
  });

  // events
  container.querySelectorAll('.fm-check').forEach(el => {
    el.addEventListener('change', () => {
      const fm2 = fmLoad();
      fm2.fields[+el.dataset.idx].enabled = el.checked;
      fmSave(fm2);
    });
  });
  container.querySelectorAll('.fm-key').forEach(el => {
    el.addEventListener('input', () => {
      const fm2 = fmLoad();
      fm2.fields[+el.dataset.idx].key = el.value;
      fmSave(fm2);
    });
  });
  container.querySelectorAll('.fm-val').forEach(el => {
    el.addEventListener('input', () => {
      const fm2 = fmLoad();
      fm2.fields[+el.dataset.idx].value = el.value;
      fmSave(fm2);
    });
  });
  container.querySelectorAll('.fm-del').forEach(el => {
    el.addEventListener('click', () => {
      const fm2 = fmLoad();
      fm2.fields.splice(+el.dataset.idx, 1);
      fmSave(fm2);
      renderFmFields(fm2);
    });
  });
}

/* ════════════════════════════════════════════════════
   TEMPLATE MANAGER MODAL
════════════════════════════════════════════════════ */
function openTplManager() {
  $('tpl-manager-modal').classList.remove('hidden');
  renderTplManager();
}
function closeTplManager() {
  $('tpl-manager-modal').classList.add('hidden');
}

function renderTplManager() {
  const templates = tmLoad();
  const list = $('tpl-list');
  list.innerHTML = '';

  templates.forEach((tpl, i) => {
    const item = document.createElement('div');
    item.className = 'tpl-item';
    item.innerHTML = `
      <div class="tpl-item-head">
        <input class="tpl-icon-inp" type="text" value="${esc(tpl.icon||'📄')}" data-idx="${i}" maxlength="4" title="アイコン">
        <input class="tpl-name-inp" type="text" value="${esc(tpl.name)}" data-idx="${i}" placeholder="テンプレート名">
        <select class="tpl-ext-sel" data-idx="${i}">
          <option value="md" ${tpl.ext==='md'?'selected':''}>md</option>
          <option value="txt" ${tpl.ext==='txt'?'selected':''}>txt</option>
        </select>
        <button class="tpl-del-btn" data-idx="${i}" title="削除">✕</button>
      </div>
      <textarea class="tpl-body" data-idx="${i}" placeholder="テンプレート本文…" rows="5">${esc(tpl.content||'')}</textarea>
    `;
    list.appendChild(item);
  });

  // events
  list.querySelectorAll('.tpl-icon-inp').forEach(el => {
    el.addEventListener('input', () => {
      const tpls = tmLoad(); tpls[+el.dataset.idx].icon = el.value; tmSave(tpls);
    });
  });
  list.querySelectorAll('.tpl-name-inp').forEach(el => {
    el.addEventListener('input', () => {
      const tpls = tmLoad(); tpls[+el.dataset.idx].name = el.value; tmSave(tpls);
    });
  });
  list.querySelectorAll('.tpl-ext-sel').forEach(el => {
    el.addEventListener('change', () => {
      const tpls = tmLoad(); tpls[+el.dataset.idx].ext = el.value; tmSave(tpls);
    });
  });
  list.querySelectorAll('.tpl-body').forEach(el => {
    el.addEventListener('input', () => {
      const tpls = tmLoad(); tpls[+el.dataset.idx].content = el.value; tmSave(tpls);
    });
  });
  list.querySelectorAll('.tpl-del-btn').forEach(el => {
    el.addEventListener('click', () => {
      if (!confirm('このテンプレートを削除しますか？')) return;
      const tpls = tmLoad(); tpls.splice(+el.dataset.idx, 1); tmSave(tpls);
      renderTplManager();
    });
  });
}

/* ────────────────────────────────────────────────────
   FORMAT PICKER (.md / .txt)
──────────────────────────────────────────────────── */
function setFmt(ext, updateRecord = true) {
  S.ext = ext;
  fileExt.textContent = '.' + ext;
  document.querySelectorAll('.fmt-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.fmt === ext);
  });
  if (updateRecord && S.id) {
    dbUpdate(S.id, { ext });
  }
}

document.querySelectorAll('.fmt-btn').forEach(b => {
  b.addEventListener('click', () => {
    setFmt(b.dataset.fmt);
    fsFileHandle = null;
  });
});

/* ────────────────────────────────────────────────────
   SIDEBAR
──────────────────────────────────────────────────── */
function openSidebar() { renderFileList(); sidebar.classList.add('open'); sbOverlay.classList.add('active'); }
function closeSidebar() { sidebar.classList.remove('open'); sbOverlay.classList.remove('active'); }

function fmtDate(ts) {
  const d = new Date(ts), n = Date.now(), diff = n - ts;
  if (diff < 60000)    return 'たった今';
  if (diff < 3600000)  return Math.floor(diff/60000) + '分前';
  if (diff < 86400000) return Math.floor(diff/3600000) + '時間前';
  return (d.getMonth()+1) + '/' + d.getDate();
}

function renderFileList() {
  const files = lsLoad();
  fileList.innerHTML = '';
  if (files.length === 0) { sbEmpty.classList.add('show'); return; }
  sbEmpty.classList.remove('show');

  files.forEach(f => {
    const el = document.createElement('div');
    el.className = 'fi' + (f.id === S.id ? ' active' : '');
    const preview = (f.content||'').replace(/^---[\s\S]*?---\n?/,'').split('\n')[0].replace(/^#+\s*/,'').slice(0,36) || '(空)';

    el.innerHTML = `
      <span class="fi-icon">◇</span>
      <div class="fi-info">
        <div class="fi-name">${esc(f.name)}.${esc(f.ext||'md')}</div>
        <div class="fi-meta">${fmtDate(f.updatedAt)} · ${esc(preview)}</div>
      </div>
      <button class="fi-del" data-id="${f.id}" title="削除">✕</button>`;

    el.addEventListener('click', e => {
      if (e.target.classList.contains('fi-del')) return;
      if (S.modified && !confirm('変更が保存されていません。切り替えますか？')) return;
      clearTimeout(asTimer);
      fsFileHandle = null;
      const rec = dbGet(f.id);
      if (rec) { loadIntoEditor(rec); renderFileList(); closeSidebar(); }
    });

    el.querySelector('.fi-del').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`「${f.name}」を完全に削除しますか？`)) return;
      const idToDelete = e.target.dataset.id;
      const remaining = dbDelete(idToDelete);
      if (idToDelete === S.id) {
        clearTimeout(asTimer);
        fsFileHandle = null;
        if (remaining.length > 0) {
          loadIntoEditor(remaining[0]);
        } else {
          const rec = dbCreate('untitled', '');
          loadIntoEditor(rec);
        }
      }
      renderFileList();
      toast('削除しました');
    });

    fileList.appendChild(el);
  });
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

/* ────────────────────────────────────────────────────
   PREVIEW
──────────────────────────────────────────────────── */
function renderPreview() { previewBody.innerHTML = renderMd(editor.value); }

function togglePreview() {
  S.preview = !S.preview;
  $('btn-preview').classList.toggle('active', S.preview);
  if (S.preview) { renderPreview(); previewWrap.classList.remove('hidden'); }
  else            { previewWrap.classList.add('hidden'); editor.focus(); }
}

$('preview-close').addEventListener('click', () => {
  S.preview = false;
  $('btn-preview').classList.remove('active');
  previewWrap.classList.add('hidden');
  editor.focus();
});

/* ────────────────────────────────────────────────────
   FOCUS MODE
──────────────────────────────────────────────────── */
function toggleFocus() {
  S.focus = !S.focus;
  document.body.classList.toggle('focus', S.focus);
  $('btn-focus').classList.toggle('active', S.focus);
}

/* ────────────────────────────────────────────────────
   FILENAME AUTO-WIDTH
──────────────────────────────────────────────────── */
function resizeFn() {
  const span = Object.assign(document.createElement('span'), {
    style: 'position:absolute;visibility:hidden;font-family:"Noto Sans JP",sans-serif;font-weight:400;font-size:14px;white-space:pre'
  });
  span.textContent = filename.value || 'untitled';
  document.body.appendChild(span);
  filename.style.width = Math.min(200, Math.max(50, span.offsetWidth + 10)) + 'px';
  document.body.removeChild(span);
}

/* ────────────────────────────────────────────────────
   SHARE MODAL
──────────────────────────────────────────────────── */
function openShare() {
  shareModal.classList.remove('hidden');
  switchTab('qr');
  $('mail-subject').value = (filename.value.trim()||'untitled') + '.' + S.ext + ' の共有';
  $('copy-preview').textContent = editor.value.slice(0, 500) + (editor.value.length > 500 ? '\n…' : '');
  $('qr-canvas').style.display = 'none';
  $('qr-placeholder').style.display = 'block';
  $('qr-note').textContent = '';
  $('btn-qr-dl').style.display = 'none';
  $('mail-msg').textContent = '';
}
function closeShare() { shareModal.classList.add('hidden'); }

function switchTab(id) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === id));
  document.querySelectorAll('.tab-body').forEach(p => p.classList.toggle('active', p.id === 'tb-' + id));
}
document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => switchTab(b.dataset.tab)));

/* ── QR ── */
function generateQR() {
  const canvas = $('qr-canvas');
  const note   = $('qr-note');
  const ph     = $('qr-placeholder');

  if (!canvas) return;
  const text = editor.value.trim();

  if (!text) { note.textContent = 'テキストを入力してください'; return; }
  if (typeof qrcode === 'undefined') {
    note.textContent = 'エラー: qrcode_UTF8.js が読み込まれていません'; return;
  }

  try {
    const qr = qrcode(0, 'L');
    qr.addData(text, 'Byte');
    qr.make();

    ph.style.display = 'none';
    canvas.style.display = 'block';

    const moduleCount = qr.getModuleCount();
    const margin = 2;
    const cellSize = Math.floor(210 / (moduleCount + margin * 2)) || 2;
    canvas.width = canvas.height = (moduleCount + margin * 2) * cellSize;

    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2a2520';

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect((c + margin) * cellSize, (r + margin) * cellSize, cellSize, cellSize);
        }
      }
    }
    note.textContent = `${text.length} 文字のQRを生成しました`;
    if ($('btn-qr-dl')) $('btn-qr-dl').style.display = 'inline-flex';
  } catch (e) {
    note.textContent = '生成失敗: ' + (e.message || '設定に問題があります');
    canvas.style.display = 'none';
    ph.style.display = 'block';
  }
}

function downloadQR() {
  const canvas = $('qr-canvas');
  if (canvas.style.display === 'none') return;
  const a = Object.assign(document.createElement('a'), {
    download: (filename.value.trim()||'shizuku') + '_qr.png',
    href: canvas.toDataURL('image/png')
  });
  a.click();
}

/* ── MAIL ── */
function sendMail() {
  const to      = $('mail-to').value.trim();
  const subject = $('mail-subject').value.trim() || filename.value + '.' + S.ext;
  const memo    = $('mail-memo').value.trim();
  const content = editor.value;
  const msgEl   = $('mail-msg');

  if (!to) { msgEl.textContent = '送信先を入力してください'; return; }

  const body = (memo ? memo + '\n\n---\n\n' : '') + content;
  const link = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  if (link.length > 8000) {
    msgEl.textContent = 'テキストが長いため、保存ボタンでファイルを保存してから添付してください。';
    return;
  }
  window.location.href = link;
  msgEl.textContent = 'メールアプリを起動しています…';
  setTimeout(() => { msgEl.textContent = ''; }, 3000);
}

/* ── COPY ── */
function copyText() {
  const btn = $('btn-copy');
  const t = editor.value;
  const finish = () => {
    btn.textContent = '✓ コピーしました';
    toast('コピーしました');
    setTimeout(() => { btn.textContent = 'コピーする'; }, 2000);
  };
  if (navigator.clipboard) {
    navigator.clipboard.writeText(t).then(finish).catch(() => fallbackCopy(t, finish));
  } else { fallbackCopy(t, finish); }
}
function fallbackCopy(text, cb) {
  const ta = Object.assign(document.createElement('textarea'), { value: text, style: 'position:fixed;opacity:0' });
  document.body.appendChild(ta); ta.select(); document.execCommand('copy'); document.body.removeChild(ta);
  cb();
}

/* ────────────────────────────────────────────────────
   TAB KEY
──────────────────────────────────────────────────── */
editor.addEventListener('keydown', e => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  const s = editor.selectionStart, end = editor.selectionEnd;
  editor.value = editor.value.slice(0, s) + '  ' + editor.value.slice(end);
  editor.selectionStart = editor.selectionEnd = s + 2;
});

/* ────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
──────────────────────────────────────────────────── */
document.addEventListener('keydown', e => {
  const m = e.metaKey || e.ctrlKey;
  if (m && e.key==='s') { e.preventDefault(); manualSave(); return; }
  if (m && e.key==='n') { e.preventDefault(); newFile(); return; }
  if (m && e.key==='o') { e.preventDefault(); openFile(); return; }
  if (m && e.key==='p') { e.preventDefault(); togglePreview(); return; }
  if (m && e.key==='.') { e.preventDefault(); toggleFocus(); return; }
  if (e.key==='Escape') {
    if (!$('new-file-modal').classList.contains('hidden')) { closeNewFileModal(); return; }
    if (!$('tpl-manager-modal').classList.contains('hidden')) { closeTplManager(); return; }
    if (!shareModal.classList.contains('hidden')) { closeShare(); return; }
    if (sidebar.classList.contains('open'))       { closeSidebar(); return; }
    if (S.preview) { togglePreview(); return; }
    if (S.focus)   { toggleFocus(); return; }
  }
});

/* ────────────────────────────────────────────────────
   EDITOR EVENTS
──────────────────────────────────────────────────── */
editor.addEventListener('input', () => {
  updateStats();
  setModified(true);
  scheduleAutoSave();
});

filename.addEventListener('input', () => {
  resizeFn();
  setModified(true);
  scheduleAutoSave();
});

/* ────────────────────────────────────────────────────
   BUTTON WIRING
──────────────────────────────────────────────────── */
$('btn-sidebar').addEventListener('click', openSidebar);
$('btn-sb-close').addEventListener('click', closeSidebar);
sbOverlay.addEventListener('click', closeSidebar);
$('btn-new').addEventListener('click', newFile);
$('btn-open').addEventListener('click', openFile);
$('btn-save').addEventListener('click', manualSave);
$('btn-preview').addEventListener('click', togglePreview);
$('btn-share').addEventListener('click', openShare);
$('btn-focus').addEventListener('click', toggleFocus);
$('share-close').addEventListener('click', closeShare);
$('share-bg').addEventListener('click', closeShare);
$('btn-qr-gen').addEventListener('click', generateQR);
$('btn-qr-dl').addEventListener('click', downloadQR);
$('btn-mail-send').addEventListener('click', sendMail);
$('btn-copy').addEventListener('click', copyText);

// New file modal
$('nf-cancel').addEventListener('click', closeNewFileModal);
$('nf-bg').addEventListener('click', closeNewFileModal);
$('nf-fm-toggle').addEventListener('change', e => {
  const fm = fmLoad();
  fm.enabled = e.target.checked;
  fmSave(fm);
  $('nf-fm-body').classList.toggle('visible', fm.enabled);
});
$('nf-fm-add').addEventListener('click', () => {
  const fm = fmLoad();
  fm.fields.push({ key: '', value: '', enabled: true });
  fmSave(fm);
  renderFmFields(fm);
  // フォーカスを最後のkeyフィールドへ
  const keys = $('nf-fm-fields').querySelectorAll('.fm-key');
  if (keys.length) keys[keys.length-1].focus();
});
$('nf-open-tpl-mgr').addEventListener('click', () => {
  closeNewFileModal();
  openTplManager();
});

// Template manager modal
$('tpl-mgr-close').addEventListener('click', closeTplManager);
$('tpl-mgr-bg').addEventListener('click', closeTplManager);
$('tpl-add-btn').addEventListener('click', () => {
  const tpls = tmLoad();
  tpls.push({ id: genId(), name: '新しいテンプレート', icon: '📄', ext: 'md', content: '' });
  tmSave(tpls);
  renderTplManager();
  // scroll to bottom
  $('tpl-list').lastElementChild?.scrollIntoView({ behavior: 'smooth' });
});
$('tpl-reset-btn').addEventListener('click', () => {
  if (!confirm('テンプレートをデフォルトに戻しますか？')) return;
  tmSave(defaultTemplates());
  renderTplManager();
  toast('テンプレートをリセットしました');
});

/* ────────────────────────────────────────────────────
   INIT
──────────────────────────────────────────────────── */
(function init() {
  if (!FS_SUPPORTED) {
    if (!localStorage.getItem('sz_fs_notice')) {
      localStorage.setItem('sz_fs_notice', '1');
      setTimeout(() => toast('💡 Chrome/Edgeではファイルを直接保存できます'), 1500);
    }
  }

  // フロントマター初期状態を反映
  const fm = fmLoad();
  const fmToggle = $('nf-fm-toggle');
  if (fmToggle) fmToggle.checked = fm.enabled;
  const fmBody = $('nf-fm-body');
  if (fmBody) fmBody.classList.toggle('visible', fm.enabled);

  const files = lsLoad();
  const curId = lsCurGet();

  if (files.length === 0) {
    const welcome = `# ようこそ、しずくへ

執筆に集中するためのMarkdownエディタです。

## 使い方

- **保存** — ⌘S でファイルを保存
- **プレビュー** — ⌘P でMarkdownのプレビュー（全画面）
- **フォーカスモード** — ⌘. でUIを非表示にして集中
- **共有** — 右上の共有ボタンでQRコードやメールで送信
- **新規作成** — ＋ボタンまたは ⌘N でテンプレート選択

## ファイル保存について

Chrome/Edge では「保存」ボタンを押すと、  
**お使いのPCに直接ファイルを書き込みます**。  
Safari/Firefox ではダウンロードになります。

テキストは自動的にブラウザに保存されます。

---

**さあ、書き始めましょう。**`;
    const rec = dbCreate('ようこそ', welcome, 'md');
    loadIntoEditor(rec);
  } else {
    const rec = curId ? dbGet(curId) : null;
    loadIntoEditor(rec || files[0]);
  }

  updateStats();
  resizeFn();
  editor.focus();
})();
