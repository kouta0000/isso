/* ══════════════════════════════════════════════════════
   しずく — app.js
   File System Access API + localStorage fallback
   Precision engineered.
══════════════════════════════════════════════════════ */
'use strict';

/* ────────────────────────────────────────────────────
   FILE SYSTEM ACCESS API
   Chrome/Edge 86+ でローカルファイルを直接読み書きできる。
   未対応ブラウザはダウンロード方式にフォールバック。
──────────────────────────────────────────────────── */
const FS_SUPPORTED = typeof window.showSaveFilePicker === 'function';

// 現在開いているファイルハンドル（File System Access API）
let fsFileHandle = null;

async function saveViaFSAPI(content, name, ext) {
  try {
    if (!fsFileHandle) {
      // 新規 — 保存先を選ばせる
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
    // 書き込み
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

// フォールバック: <a download> でダウンロード
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
   LOCALSTORAGE ENGINE（アプリ内ファイル管理）
   Key: "sz_files" → FileRecord[]
   Key: "sz_cur"   → current file id
──────────────────────────────────────────────────── */
const LS_FILES = 'sz_files';
const LS_CUR   = 'sz_cur';

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
   MARKDOWN RENDERER
──────────────────────────────────────────────────── */
function renderMd(src) {
  const E = s => s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

  // protect code blocks
  const blocks = [], inlines = [];
  let t = src
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

  // lists
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

  // paragraphs
  t = t.split(/\n{2,}/).map(b => {
    b = b.trim(); if(!b) return '';
    if(/^<(h[1-6]|ul|ol|pre|blockquote|hr|div|table)/.test(b)) return b;
    if(/^\x02/.test(b)) return b;
    return '<p>'+b.replace(/\n/g,'<br>')+'</p>';
  }).join('\n');

  // restore
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
  id:        null,   // current record id in localStorage
  ext:       'md',   // 'md' | 'txt'
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

/* ────────────────────────────────────────────────────
   UNSAVED DOT
──────────────────────────────────────────────────── */
function setModified(v) {
  S.modified = v;
  dotUnsaved.classList.toggle('on', v);
}

/* ────────────────────────────────────────────────────
   AUTO-SAVE to localStorage
   Debounced 800ms after last keystroke.
   Saves CONTENT to the current record (or creates one).
   Does NOT download — that's manual save only.
──────────────────────────────────────────────────── */
let asTimer;
function scheduleAutoSave() {
  clearTimeout(asTimer);
  asTimer = setTimeout(() => {
    const name = filename.value.trim() || 'untitled';
    const content = editor.value;
    if (!S.id) {
      // 初回：レコード作成
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
   1. localStorage に書き込む
   2. File System Access API が使える場合 → ディスクに直接書き込む
      使えない場合 → ダウンロード
──────────────────────────────────────────────────── */
async function manualSave() {
  clearTimeout(asTimer);
  const name    = filename.value.trim() || 'untitled';
  const content = editor.value;
  const ext     = S.ext;

  // 1. localStorage
  if (!S.id) {
    const rec = dbCreate(name, content, ext);
    S.id = rec.id;
  } else {
    dbUpdate(S.id, { name, content, ext });
  }
  setModified(false);
  renderFileList();
  lsCurSet(S.id);

  // 2. ディスクへ
  if (FS_SUPPORTED) {
    stMsg.textContent = '保存中…';
    const res = await saveViaFSAPI(content, name, ext);
    if (res.ok) {
      toast('💾 ' + res.fileName + ' を保存しました');
      stMsg.textContent = '保存しました';
    } else if (!res.aborted) {
      // FS API失敗 → フォールバック
      downloadFile(content, name, ext);
      toast('⬇ ' + name + '.' + ext + ' をダウンロードしました');
      stMsg.textContent = 'ダウンロード完了';
    } else {
      stMsg.textContent = '';
      return;
    }
  } else {
    // フォールバック
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
    // auto-save to localStorage
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
  // rec: { id, name, content, ext }
  fsFileHandle = null; // 新しいファイルはハンドルリセット
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
   NEW FILE
──────────────────────────────────────────────────── */
function newFile() {
  if (S.modified && !confirm('変更が保存されていません。新規作成しますか？')) return;
  clearTimeout(asTimer);
  fsFileHandle = null;
  const rec = dbCreate('untitled', '', S.ext);
  loadIntoEditor(rec);
  renderFileList();
  closeSidebar();
  editor.focus();
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
    // ハンドルをリセット（拡張子が変わったので新規保存先を選ばせる）
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
    const preview = (f.content||'').split('\n')[0].replace(/^#+\s*/,'').slice(0,36) || '(空)';
    
    // HTML構造: 削除用のボタンを追加
    el.innerHTML = `
      <span class="fi-icon">◇</span>
      <div class="fi-info">
        <div class="fi-name">${esc(f.name)}.${esc(f.ext||'md')}</div>
        <div class="fi-meta">${fmtDate(f.updatedAt)} · ${esc(preview)}</div>
      </div>
      <button class="fi-del" data-id="${f.id}" title="削除">✕</button>`;

    // ファイルを選択して開くイベント
    el.addEventListener('click', e => {
      if (e.target.classList.contains('fi-del')) return;
      if (S.modified && !confirm('変更が保存されていません。切り替えますか？')) return;
      clearTimeout(asTimer); 
      fsFileHandle = null;
      const rec = dbGet(f.id);
      if (rec) { loadIntoEditor(rec); renderFileList(); closeSidebar(); }
    });

    // ✕ボタンを押した時の削除イベント
    el.querySelector('.fi-del').addEventListener('click', e => {
      e.stopPropagation(); // 親要素の「ファイルを開く」イベントを阻止
      if (!confirm(`「${f.name}」を完全に削除しますか？`)) return;
      
      const idToDelete = e.target.dataset.id;
      const remaining = dbDelete(idToDelete);

      // 削除したのが現在編集中のファイルだった場合、次のファイルを表示
      if (idToDelete === S.id) {
        clearTimeout(asTimer);
        fsFileHandle = null;
        if (remaining.length > 0) {
          loadIntoEditor(remaining[0]);
        } else {
          // ファイルがゼロになったら新規作成
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
   PREVIEW — full-screen overlay, toggle
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
  // reset QR
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
/* ── QR ── */
/* ── QR 生成ロジック（最終調整版） ── */
function generateQR() {
  const canvas = document.getElementById('qr-canvas');
  const note   = document.getElementById('qr-note');
  const ph     = document.getElementById('qr-placeholder');
  const editor = document.getElementById('editor');

  if (!canvas || !editor) return;
  const text = editor.value.trim();

  if (!text) {
    note.textContent = 'テキストを入力してください';
    return;
  }

  // ライブラリの存在を再確認
  if (typeof qrcode === 'undefined') {
    note.textContent = 'エラー: qrcode_UTF8.js が読み込まれていません';
    return;
  }

  try {
    /* ドキュメント準拠の修正：
       1. typeNumber を 0 (自動) ではなく、最小の 1 から開始させる。
       2. 誤り訂正レベルを明示。
    */
    const typeNumber = 0; 
    const errorCorrectionLevel = 'L';
    const qr = qrcode(typeNumber, errorCorrectionLevel);

    /* 重要：UTF8版の場合、addDataの第2引数にモードを指定しないと
       内部のバイト判定でコケて「制限超え」の誤判定を出すことがあります。
    */
    qr.addData(text, 'Byte'); 
    qr.make();

    // 描画処理：Canvasが非表示だとサイズ計算に失敗するため、先に表示
    ph.style.display = 'none';
    canvas.style.display = 'block';

    const moduleCount = qr.getModuleCount();
    const margin = 2;
    const cellSize = Math.floor(210 / (moduleCount + margin * 2)) || 2;
    
    canvas.width = canvas.height = (moduleCount + margin * 2) * cellSize;

    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas context failed');

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#2a2520';

    for (let r = 0; r < moduleCount; r++) {
      for (let c = 0; c < moduleCount; c++) {
        if (qr.isDark(r, c)) {
          ctx.fillRect(
            (c + margin) * cellSize, 
            (r + margin) * cellSize, 
            cellSize, 
            cellSize
          );
        }
      }
    }

    note.textContent = `${text.length} 文字のQRを生成しました`;
    if ($('btn-qr-dl')) $('btn-qr-dl').style.display = 'inline-flex';

  } catch (e) {
    console.error('QR Failure Details:', e);
    // e.message に具体的な理由（'Invalid type number' など）が含まれるはずです
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
    msgEl.textContent = 'テキストが長いため、メールアプリで開けない場合があります。保存ボタンでファイルを保存してから添付してください。';
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
  const finish = () => { btn.textContent = '✓ コピーしました'; toast('コピーしました'); setTimeout(() => { btn.textContent = 'コピーする'; }, 2000); };
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

/* ────────────────────────────────────────────────────
   INIT
──────────────────────────────────────────────────── */
(function init() {
  // FS API対応状況をステータスバーに反映
  if (!FS_SUPPORTED) {
    // フォールバック時の案内（初回のみ）
    if (!localStorage.getItem('sz_fs_notice')) {
      localStorage.setItem('sz_fs_notice', '1');
      setTimeout(() => toast('💡 Chrome/Edgeではファイルを直接保存できます'), 1500);
    }
  }

  const files = lsLoad();
  const curId = lsCurGet();

  if (files.length === 0) {
    // ウェルカムファイル
    const welcome = `# ようこそ、しずくへ

執筆に集中するためのMarkdownエディタです。

## 使い方

- **保存** — ⌘S でファイルを保存
- **プレビュー** — ⌘P でMarkdownのプレビュー（全画面）
- **フォーカスモード** — ⌘. でUIを非表示にして集中
- **共有** — 右上の共有ボタンでQRコードやメールで送信

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
