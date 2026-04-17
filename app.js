/* ═══════════════════════════════════════════════════════
   しずく — Markdown Editor
   Core app logic — precision engineered
═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────────────
   STORAGE ENGINE
   Files are stored as JSON objects in localStorage.
   Key: "shizuku_files" → Array of FileRecord
   Key: "shizuku_current" → current file id
   FileRecord: { id, name, content, createdAt, updatedAt }
───────────────────────────────────────────────────── */

const STORAGE_KEY  = 'shizuku_files';
const CURRENT_KEY  = 'shizuku_current';

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function loadAllFiles() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveAllFiles(files) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(files));
    return true;
  } catch (e) {
    // localStorage full or disabled
    console.warn('Storage error:', e);
    return false;
  }
}

function getCurrentId() {
  return localStorage.getItem(CURRENT_KEY) || null;
}

function setCurrentId(id) {
  localStorage.setItem(CURRENT_KEY, id);
}

/* ─────────────────────────────────────────────────────
   FILE OPERATIONS
───────────────────────────────────────────────────── */

function createFile(name, content = '') {
  const files = loadAllFiles();
  const id = genId();
  const now = Date.now();
  const record = { id, name: name || 'untitled', content, createdAt: now, updatedAt: now };
  files.unshift(record);
  saveAllFiles(files);
  setCurrentId(id);
  return record;
}

function updateFile(id, patch) {
  const files = loadAllFiles();
  const idx = files.findIndex(f => f.id === id);
  if (idx === -1) return null;
  files[idx] = { ...files[idx], ...patch, updatedAt: Date.now() };
  saveAllFiles(files);
  return files[idx];
}

function deleteFile(id) {
  let files = loadAllFiles();
  files = files.filter(f => f.id !== id);
  saveAllFiles(files);
  return files;
}

function getFile(id) {
  return loadAllFiles().find(f => f.id === id) || null;
}

/* ─────────────────────────────────────────────────────
   MARKDOWN RENDERER
   Precise, minimal, no dependencies
───────────────────────────────────────────────────── */

function renderMarkdown(src) {
  // Escape HTML in a safe context
  const esc = s => s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

  // Store code blocks to protect them
  const codeBlocks = [];
  let text = src.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push(`<pre><code class="lang-${esc(lang)}">${esc(code.trim())}</code></pre>`);
    return `\x00CODE${idx}\x00`;
  });

  // Inline code
  const inlineCodes = [];
  text = text.replace(/`([^`]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(`<code>${esc(code)}</code>`);
    return `\x00INLINE${idx}\x00`;
  });

  // Escape rest
  text = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  text = text
    .replace(/^#{6}\s+(.+)$/gm, '<h6>$1</h6>')
    .replace(/^#{5}\s+(.+)$/gm, '<h5>$1</h5>')
    .replace(/^#{4}\s+(.+)$/gm, '<h4>$1</h4>')
    .replace(/^#{3}\s+(.+)$/gm, '<h3>$1</h3>')
    .replace(/^#{2}\s+(.+)$/gm, '<h2>$1</h2>')
    .replace(/^#{1}\s+(.+)$/gm, '<h1>$1</h1>');

  // HR
  text = text.replace(/^[-*_]{3,}\s*$/gm, '<hr>');

  // Blockquote
  text = text.replace(/^&gt;\s?(.*)$/gm, '<blockquote>$1</blockquote>');
  text = text.replace(/<\/blockquote>\n<blockquote>/g, '\n');

  // Bold + italic
  text = text
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/___(.+?)___/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/_([^_\n]+)_/g, '<em>$1</em>');

  // Strikethrough
  text = text.replace(/~~(.+?)~~/g, '<del>$1</del>');

  // Images (before links)
  text = text.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');

  // Links
  text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

  // Lists — process line by line
  const lines = text.split('\n');
  const result = [];
  let inUl = false, inOl = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (/^\s*[-*+]\s/.test(line)) {
      if (!inUl) { if (inOl) { result.push('</ol>'); inOl = false; } result.push('<ul>'); inUl = true; }
      result.push('<li>' + line.replace(/^\s*[-*+]\s/, '') + '</li>');
    } else if (/^\s*\d+\.\s/.test(line)) {
      if (!inOl) { if (inUl) { result.push('</ul>'); inUl = false; } result.push('<ol>'); inOl = true; }
      result.push('<li>' + line.replace(/^\s*\d+\.\s/, '') + '</li>');
    } else {
      if (inUl) { result.push('</ul>'); inUl = false; }
      if (inOl) { result.push('</ol>'); inOl = false; }
      result.push(line);
    }
  }
  if (inUl) result.push('</ul>');
  if (inOl) result.push('</ol>');

  text = result.join('\n');

  // Paragraphs — group non-block lines
  const paras = text.split(/\n{2,}/);
  text = paras.map(block => {
    block = block.trim();
    if (!block) return '';
    // Don't wrap block-level elements
    if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr|div|table|thead|tbody|tr|th|td)/.test(block)) return block;
    // Don't wrap placeholders
    if (/^\x00(CODE|INLINE)/.test(block)) return block;
    // Wrap single newlines as <br>
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');

  // Restore code blocks
  text = text.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[+i]);
  text = text.replace(/\x00INLINE(\d+)\x00/g, (_, i) => inlineCodes[+i]);

  return text;
}

/* ─────────────────────────────────────────────────────
   DOM REFS
───────────────────────────────────────────────────── */

const $ = id => document.getElementById(id);

const editor       = $('editor');
const filenameInput= $('filename');
const saveDot      = $('save-dot');
const wordCountEl  = $('word-count');
const lineCountEl  = $('line-count');
const autosaveEl   = $('autosave-status');
const previewPane  = $('preview-pane');
const previewContent=$('preview-content');
const editorPane   = $('editor-pane');
const sidebar      = $('sidebar');
const sidebarOverlay=$('sidebar-overlay');
const fileList     = $('file-list');
const sidebarEmpty = $('sidebar-empty');
const shareModal   = $('share-modal');
const toastEl      = $('toast');
const fileInput    = $('file-input');

/* ─────────────────────────────────────────────────────
   APP STATE
───────────────────────────────────────────────────── */

const state = {
  currentId:   null,
  modified:    false,
  previewMode: false,
  focusMode:   false,
};

/* ─────────────────────────────────────────────────────
   TOAST
───────────────────────────────────────────────────── */

let toastTimer;
function showToast(msg, duration = 2200) {
  clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), duration);
}

/* ─────────────────────────────────────────────────────
   STATS
───────────────────────────────────────────────────── */

function updateStats() {
  const text = editor.value;
  wordCountEl.textContent = text.length.toLocaleString('ja-JP') + ' 文字';
  lineCountEl.textContent = (text === '' ? 1 : text.split('\n').length).toLocaleString('ja-JP') + ' 行';
}

/* ─────────────────────────────────────────────────────
   MODIFIED STATE
───────────────────────────────────────────────────── */

function setModified(val) {
  state.modified = val;
  saveDot.classList.toggle('visible', val);
}

/* ─────────────────────────────────────────────────────
   AUTO-SAVE
   Debounced write-through to localStorage record
───────────────────────────────────────────────────── */

let autoSaveTimer;

function scheduleAutoSave() {
  clearTimeout(autoSaveTimer);
  autosaveEl.textContent = '';
  autoSaveTimer = setTimeout(() => {
    if (!state.currentId) {
      // No current file — create one automatically
      const name = filenameInput.value.trim() || 'untitled';
      const rec = createFile(name, editor.value);
      state.currentId = rec.id;
    } else {
      updateFile(state.currentId, {
        name:    filenameInput.value.trim() || 'untitled',
        content: editor.value,
      });
    }
    setModified(false);
    autosaveEl.textContent = '自動保存しました';
    renderFileList();
    setTimeout(() => { autosaveEl.textContent = ''; }, 2000);
  }, 1000); // 1 second debounce
}

/* ─────────────────────────────────────────────────────
   MANUAL SAVE — also downloads .md file
───────────────────────────────────────────────────── */

function saveCurrentFile() {
  clearTimeout(autoSaveTimer);

  const name = filenameInput.value.trim() || 'untitled';
  const content = editor.value;

  if (!state.currentId) {
    const rec = createFile(name, content);
    state.currentId = rec.id;
  } else {
    updateFile(state.currentId, { name, content });
  }

  setModified(false);
  renderFileList();

  // Download as .md
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = name + '.md';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('💾 ' + name + '.md を保存しました');
}

/* ─────────────────────────────────────────────────────
   LOAD FILE INTO EDITOR
───────────────────────────────────────────────────── */

function loadFileIntoEditor(record) {
  editor.value = record.content;
  filenameInput.value = record.name;
  state.currentId = record.id;
  setCurrentId(record.id);
  setModified(false);
  updateStats();
  resizeFilename();
  if (state.previewMode) renderPreview();
}

/* ─────────────────────────────────────────────────────
   FILE LIST (SIDEBAR)
───────────────────────────────────────────────────── */

function formatDate(ts) {
  const d = new Date(ts);
  const now = new Date();
  const diff = now - d;
  if (diff < 60000) return 'たった今';
  if (diff < 3600000) return Math.floor(diff / 60000) + '分前';
  if (diff < 86400000) return Math.floor(diff / 3600000) + '時間前';
  return d.getMonth() + 1 + '/' + d.getDate();
}

function renderFileList() {
  const files = loadAllFiles();
  fileList.innerHTML = '';

  if (files.length === 0) {
    sidebarEmpty.classList.add('show');
    return;
  }
  sidebarEmpty.classList.remove('show');

  files.forEach(f => {
    const item = document.createElement('div');
    item.className = 'file-item' + (f.id === state.currentId ? ' active' : '');
    item.dataset.id = f.id;

    // preview first line
    const preview = (f.content || '').split('\n')[0].replace(/^#+\s*/, '').slice(0, 40) || '(空)';

    item.innerHTML = `
      <span class="file-icon">◇</span>
      <div class="file-info">
        <div class="file-name">${escHtml(f.name)}.md</div>
        <div class="file-meta">${formatDate(f.updatedAt)} · ${preview}</div>
      </div>
      <button class="file-delete" data-id="${f.id}" title="削除">✕</button>
    `;

    item.addEventListener('click', e => {
      if (e.target.classList.contains('file-delete')) return;
      if (state.modified) {
        if (!confirm('現在の変更は保存されていません。切り替えますか？')) return;
      }
      const rec = getFile(f.id);
      if (rec) {
        loadFileIntoEditor(rec);
        renderFileList();
        closeSidebar();
      }
    });

    item.querySelector('.file-delete').addEventListener('click', e => {
      e.stopPropagation();
      if (!confirm(`「${f.name}」を削除しますか？`)) return;
      const remaining = deleteFile(f.id);
      if (f.id === state.currentId) {
        if (remaining.length > 0) {
          loadFileIntoEditor(remaining[0]);
        } else {
          newFile(true);
        }
      }
      renderFileList();
      showToast('削除しました');
    });

    fileList.appendChild(item);
  });
}

function escHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

/* ─────────────────────────────────────────────────────
   NEW / OPEN / IMPORT
───────────────────────────────────────────────────── */

function newFile(force = false) {
  if (!force && state.modified) {
    if (!confirm('保存されていない変更があります。新規作成しますか？')) return;
  }
  clearTimeout(autoSaveTimer);
  const rec = createFile('untitled', '');
  loadFileIntoEditor(rec);
  renderFileList();
  closeSidebar();
  editor.focus();
}

function importFile() {
  fileInput.click();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    const content = e.target.result;
    const name = file.name.replace(/\.(md|txt)$/i, '');
    const rec = createFile(name, content);
    loadFileIntoEditor(rec);
    renderFileList();
    closeSidebar();
    showToast('📄 ' + name + '.md を読み込みました');
  };
  reader.readAsText(file, 'UTF-8');
  fileInput.value = '';
});

/* ─────────────────────────────────────────────────────
   SIDEBAR
───────────────────────────────────────────────────── */

function openSidebar() {
  renderFileList();
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('active');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('active');
}

/* ─────────────────────────────────────────────────────
   PREVIEW
───────────────────────────────────────────────────── */

function renderPreview() {
  previewContent.innerHTML = renderMarkdown(editor.value);
}

function togglePreview() {
  state.previewMode = !state.previewMode;
  const btn = $('btn-preview');
  if (state.previewMode) {
    renderPreview();
    previewPane.classList.remove('hidden');
    editorPane.classList.add('hidden');
    btn.classList.add('active');
  } else {
    previewPane.classList.add('hidden');
    editorPane.classList.remove('hidden');
    btn.classList.remove('active');
    editor.focus();
  }
}

/* ─────────────────────────────────────────────────────
   FOCUS MODE
───────────────────────────────────────────────────── */

function toggleFocus() {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle('focus-mode', state.focusMode);
  $('btn-focus').classList.toggle('active', state.focusMode);
}

/* ─────────────────────────────────────────────────────
   FILENAME RESIZE
───────────────────────────────────────────────────── */

function resizeFilename() {
  const tmp = document.createElement('span');
  tmp.style.cssText = 'position:absolute;visibility:hidden;font-family:"Noto Sans JP",sans-serif;font-weight:400;font-size:14px;white-space:pre;pointer-events:none';
  tmp.textContent = filenameInput.value || 'untitled';
  document.body.appendChild(tmp);
  filenameInput.style.width = Math.min(220, Math.max(60, tmp.offsetWidth + 8)) + 'px';
  document.body.removeChild(tmp);
}

/* ─────────────────────────────────────────────────────
   SHARE MODAL — TABS
───────────────────────────────────────────────────── */

function openShareModal() {
  shareModal.classList.remove('hidden');
  // Reset to QR tab
  switchTab('qr');
  // Pre-fill email subject
  $('email-subject').value = (filenameInput.value.trim() || 'untitled') + '.md の共有';
  // Pre-fill copy preview
  $('copy-preview').textContent = editor.value.slice(0, 400) + (editor.value.length > 400 ? '\n…' : '');
  // Reset QR
  $('qr-canvas').style.display = 'none';
  $('qr-placeholder-icon').style.display = 'flex';
  $('qr-msg').textContent = '';
  $('btn-dl-qr').style.display = 'none';
}

function closeShareModal() {
  shareModal.classList.add('hidden');
}

function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tabId));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tabId));
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

/* ─────────────────────────────────────────────────────
   QR CODE GENERATION
   Strategy: encode content as data URI → QR
   Large text: compress with simple base64 + note
───────────────────────────────────────────────────── */

function generateQR() {
  const canvas = $('qr-canvas');
  const placeholder = $('qr-placeholder-icon');
  const msg = $('qr-msg');
  const dlBtn = $('btn-dl-qr');
  const text = editor.value.trim();

  if (!text) {
    msg.textContent = 'テキストを入力してから生成してください';
    return;
  }

  const MAX_CHARS = 1500;
  let payload = text;
  let truncated = false;

  if (text.length > MAX_CHARS) {
    payload = text.slice(0, MAX_CHARS);
    truncated = true;
  }

  msg.textContent = '生成中…';
  placeholder.style.display = 'none';

  // Use QRCode library
  QRCode.toCanvas(canvas, payload, {
    width: 220,
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark:  '#2c2820',
      light: '#ffffff',
    }
  }, (err) => {
    if (err) {
      placeholder.style.display = 'flex';
      canvas.style.display = 'none';
      msg.textContent = 'エラー: テキストが大きすぎます（' + text.length + '文字）';
      dlBtn.style.display = 'none';
      return;
    }
    canvas.style.display = 'block';
    dlBtn.style.display = 'inline-block';
    msg.textContent = truncated
      ? `先頭 ${MAX_CHARS} 文字のみ含まれています（全 ${text.length} 文字）`
      : `${text.length} 文字を含むQRコードを生成しました`;
  });
}

function downloadQR() {
  const canvas = $('qr-canvas');
  if (canvas.style.display === 'none') return;
  const link = document.createElement('a');
  link.download = (filenameInput.value.trim() || 'shizuku') + '_qr.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ─────────────────────────────────────────────────────
   EMAIL — mailto fallback (no server needed)
   Opens system mail app with content pre-filled
───────────────────────────────────────────────────── */

function sendEmail() {
  const to      = $('email-to').value.trim();
  const subject = $('email-subject').value.trim() || (filenameInput.value.trim() || 'untitled') + '.md';
  const memo    = $('email-msg').value.trim();
  const content = editor.value;
  const feedback= $('email-feedback');

  if (!to) {
    feedback.textContent = '送信先メールアドレスを入力してください';
    feedback.className = 'error';
    return;
  }

  // Build body: memo + separator + content
  const body = [
    memo ? memo + '\n\n---\n\n' : '',
    content
  ].join('');

  // mailto: handles small to medium content well
  const mailto = `mailto:${encodeURIComponent(to)}`
    + `?subject=${encodeURIComponent(subject)}`
    + `&body=${encodeURIComponent(body)}`;

  // Check if it might be too long for some mail clients (~2000 chars)
  if (mailto.length > 8000) {
    // Offer download instead
    if (confirm('テキストが長いためメールアプリで開けない場合があります。代わりに.mdファイルとして保存しますか？')) {
      saveCurrentFile();
      feedback.textContent = 'ファイルを保存しました。メールに添付してください。';
      feedback.className = 'success';
      return;
    }
  }

  window.location.href = mailto;
  feedback.textContent = 'メールアプリが開きます…';
  feedback.className = 'success';
  setTimeout(() => { feedback.textContent = ''; feedback.className = ''; }, 3000);
}

/* ─────────────────────────────────────────────────────
   COPY TO CLIPBOARD
───────────────────────────────────────────────────── */

function copyMarkdown() {
  const btn = $('btn-copy-md');
  navigator.clipboard.writeText(editor.value).then(() => {
    btn.textContent = '✓ コピーしました';
    showToast('クリップボードにコピーしました');
    setTimeout(() => { btn.textContent = 'コピーする'; }, 2000);
  }).catch(() => {
    // Fallback for older browsers
    const ta = document.createElement('textarea');
    ta.value = editor.value;
    ta.style.cssText = 'position:fixed;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast('コピーしました');
  });
}

/* ─────────────────────────────────────────────────────
   TAB KEY IN EDITOR
───────────────────────────────────────────────────── */

editor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

/* ─────────────────────────────────────────────────────
   KEYBOARD SHORTCUTS
───────────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;

  if (mod && e.key === 's') { e.preventDefault(); saveCurrentFile(); return; }
  if (mod && e.key === 'n') { e.preventDefault(); newFile(); return; }
  if (mod && e.key === 'o') { e.preventDefault(); importFile(); return; }
  if (mod && e.key === 'p') { e.preventDefault(); togglePreview(); return; }
  if (mod && e.key === '.') { e.preventDefault(); toggleFocus(); return; }

  if (e.key === 'Escape') {
    if (!shareModal.classList.contains('hidden')) { closeShareModal(); return; }
    if (sidebar.classList.contains('open')) { closeSidebar(); return; }
    if (state.focusMode) { toggleFocus(); return; }
  }
});

/* ─────────────────────────────────────────────────────
   EDITOR EVENTS
───────────────────────────────────────────────────── */

editor.addEventListener('input', () => {
  updateStats();
  setModified(true);
  scheduleAutoSave();
});

filenameInput.addEventListener('input', () => {
  resizeFilename();
  if (state.currentId) {
    setModified(true);
    scheduleAutoSave();
  }
});

/* ─────────────────────────────────────────────────────
   BUTTON WIRING
───────────────────────────────────────────────────── */

$('btn-files').addEventListener('click', openSidebar);
$('btn-sidebar-close').addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);

$('btn-new-file').addEventListener('click', () => newFile());
$('btn-import-file').addEventListener('click', importFile);

$('btn-save').addEventListener('click', saveCurrentFile);
$('btn-preview').addEventListener('click', togglePreview);
$('btn-share').addEventListener('click', openShareModal);
$('btn-focus').addEventListener('click', toggleFocus);

$('share-close').addEventListener('click', closeShareModal);
$('share-backdrop').addEventListener('click', closeShareModal);

$('btn-gen-qr').addEventListener('click', generateQR);
$('btn-dl-qr').addEventListener('click', downloadQR);
$('btn-send-mail').addEventListener('click', sendEmail);
$('btn-copy-md').addEventListener('click', copyMarkdown);

/* ─────────────────────────────────────────────────────
   INIT — restore last session
───────────────────────────────────────────────────── */

(function init() {
  const files = loadAllFiles();
  const lastId = getCurrentId();

  if (files.length === 0) {
    // Brand new user — create a welcome file
    const welcome = `# ようこそ、しずくへ

執筆に集中するためのMarkdownエディタです。

## 使い方

- **保存**: ⌘S（またはCTRL+S）でローカルに保存
- **プレビュー**: ⌘P でMarkdownのプレビュー表示
- **フォーカスモード**: ⌘. でUIを非表示にして執筆に集中
- **共有**: 右上の共有ボタンでQRコードやメールで共有

## Markdown サンプル

**太字** *斜体* \`コード\`

> 引用文はこのように書きます

---

ファイルは自動的に保存されます。`;

    const rec = createFile('ようこそ', welcome);
    loadFileIntoEditor(rec);
  } else {
    // Restore last opened file
    const rec = lastId ? getFile(lastId) : null;
    if (rec) {
      loadFileIntoEditor(rec);
    } else {
      loadFileIntoEditor(files[0]);
    }
  }

  updateStats();
  resizeFilename();
  editor.focus();
})();
