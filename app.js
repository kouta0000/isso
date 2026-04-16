/* ─────────────────────────────────────────
   md. — app logic
────────────────────────────────────────── */

// ── State ──────────────────────────────────
const state = {
  modified: false,
  previewMode: false,
  focusMode: false,
};

// ── DOM refs ───────────────────────────────
const editor        = document.getElementById('editor');
const filenameInput = document.getElementById('filename');
const statusEl      = document.getElementById('status');
const wordCount     = document.getElementById('word-count');
const lineCount     = document.getElementById('line-count');
const modifiedEl    = document.getElementById('modified-indicator');
const previewPanel  = document.getElementById('preview-panel');
const previewContent= document.getElementById('preview-content');
const shareModal    = document.getElementById('share-modal');
const overlay       = document.getElementById('overlay');
const fileInput     = document.getElementById('file-input');
const qrNote        = document.getElementById('qr-note');

// ── Minimal Markdown renderer ───────────────
function renderMarkdown(text) {
  let html = text
    // Escape HTML
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')

    // Code blocks
    .replace(/```([\s\S]*?)```/g, (_, code) => `<pre><code>${code.trim()}</code></pre>`)

    // Inline code
    .replace(/`([^`]+)`/g, '<code>$1</code>')

    // Headers
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/^## (.+)$/gm,  '<h2>$1</h2>')
    .replace(/^# (.+)$/gm,   '<h1>$1</h1>')

    // Blockquote
    .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')

    // HR
    .replace(/^---$/gm, '<hr>')

    // Bold / italic
    .replace(/\*\*\*(.+?)\*\*\*/g, '<em><strong>$1</strong></em>')
    .replace(/\*\*(.+?)\*\*/g,     '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g,         '<em>$1</em>')
    .replace(/_(.+?)_/g,           '<em>$1</em>')

    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')

    // Images
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')

    // Unordered list
    .replace(/^\s*[\-\*\+] (.+)$/gm, '<li>$1</li>')
    .replace(/(<li>.*<\/li>\n?)+/g, m => `<ul>${m}</ul>`)

    // Ordered list
    .replace(/^\s*\d+\. (.+)$/gm, '<li>$1</li>')

    // Paragraphs — wrap lines separated by blank lines
    .split(/\n{2,}/)
    .map(block => {
      block = block.trim();
      if (!block) return '';
      if (/^<(h[1-6]|ul|ol|li|pre|blockquote|hr)/.test(block)) return block;
      return `<p>${block.replace(/\n/g, '<br>')}</p>`;
    })
    .join('\n');

  return html;
}

// ── Stats ──────────────────────────────────
function updateStats() {
  const text = editor.value;
  const chars = text.length;
  const lines = text === '' ? 1 : text.split('\n').length;
  wordCount.textContent = `${chars.toLocaleString()} 文字`;
  lineCount.textContent = `${lines} 行`;
}

// ── Modified indicator ─────────────────────
function markModified() {
  if (!state.modified) {
    state.modified = true;
    modifiedEl.textContent = '● 未保存';
  }
}

function clearModified() {
  state.modified = false;
  modifiedEl.textContent = '';
}

// ── Auto-save to localStorage ──────────────
let autoSaveTimer;
function scheduleSave() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => {
    localStorage.setItem('md_content',  editor.value);
    localStorage.setItem('md_filename', filenameInput.value);
    statusEl.textContent = '自動保存済み';
    setTimeout(() => { statusEl.textContent = ''; }, 1600);
  }, 1200);
}

// ── Save as .md file ───────────────────────
function saveFile() {
  const blob = new Blob([editor.value], { type: 'text/markdown;charset=utf-8' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = (filenameInput.value.trim() || 'untitled') + '.md';
  a.click();
  URL.revokeObjectURL(url);
  clearModified();
  statusEl.textContent = '保存しました';
  setTimeout(() => { statusEl.textContent = ''; }, 1800);
}

// ── Open file ──────────────────────────────
function openFile() {
  fileInput.click();
}

fileInput.addEventListener('change', () => {
  const file = fileInput.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    editor.value = e.target.result;
    // Set filename without extension
    filenameInput.value = file.name.replace(/\.(md|txt)$/, '');
    updateStats();
    clearModified();
    scheduleSave();
    editor.focus();
  };
  reader.readAsText(file, 'UTF-8');
  fileInput.value = '';
});

// ── New file ───────────────────────────────
function newFile() {
  if (state.modified) {
    if (!confirm('保存されていない変更があります。新規作成しますか？')) return;
  }
  editor.value = '';
  filenameInput.value = 'untitled';
  clearModified();
  updateStats();
  editor.focus();
}

// ── Preview ────────────────────────────────
function togglePreview() {
  state.previewMode = !state.previewMode;
  const btn = document.getElementById('btn-preview');

  if (state.previewMode) {
    previewContent.innerHTML = renderMarkdown(editor.value);
    previewPanel.classList.remove('hidden');
    document.getElementById('editor-wrap').classList.add('hidden');
    btn.classList.add('active');
  } else {
    previewPanel.classList.add('hidden');
    document.getElementById('editor-wrap').classList.remove('hidden');
    btn.classList.remove('active');
    editor.focus();
  }
}

// ── Focus mode ─────────────────────────────
function toggleFocus() {
  state.focusMode = !state.focusMode;
  document.body.classList.toggle('focus-mode', state.focusMode);
  document.getElementById('btn-focus').classList.toggle('active', state.focusMode);
  // Escape to exit
}

// ── QR Code ────────────────────────────────
function generateQR() {
  const canvas = document.getElementById('qr-canvas');
  const text   = editor.value;

  if (!text.trim()) {
    qrNote.textContent = 'テキストを入力してください';
    canvas.style.display = 'none';
    return;
  }

  // QR code can hold ~2KB reliably
  const MAX = 1800;
  let content = text;
  let truncated = false;
  if (text.length > MAX) {
    content = text.slice(0, MAX);
    truncated = true;
  }

  canvas.style.display = 'block';

  QRCode.toCanvas(canvas, content, {
    width: 220,
    margin: 2,
    color: { dark: '#1a1814', light: '#ffffff' },
    errorCorrectionLevel: 'M',
  }, err => {
    if (err) {
      qrNote.textContent = 'QR生成エラー: テキストが大きすぎます';
      canvas.style.display = 'none';
    } else {
      qrNote.textContent = truncated
        ? `※ テキストが大きいため最初の${MAX}文字のみ含まれています`
        : '';
    }
  });
}

function downloadQR() {
  const canvas = document.getElementById('qr-canvas');
  if (canvas.style.display === 'none') return;
  const link = document.createElement('a');
  link.download = (filenameInput.value.trim() || 'md') + '_qr.png';
  link.href = canvas.toDataURL();
  link.click();
}

// ── Email share ───────────────────────────
function openMail() {
  const to      = document.getElementById('email-input').value.trim();
  const subject = encodeURIComponent((filenameInput.value.trim() || 'untitled') + '.md');
  const body    = encodeURIComponent(editor.value);
  const mailto  = `mailto:${to}?subject=${subject}&body=${body}`;
  window.location.href = mailto;
}

// ── Copy to clipboard ─────────────────────
function copyToClipboard() {
  const btn = document.getElementById('btn-copy');
  navigator.clipboard.writeText(editor.value).then(() => {
    btn.textContent = 'コピー完了！';
    btn.classList.add('success');
    setTimeout(() => {
      btn.textContent = 'クリップボードにコピー';
      btn.classList.remove('success');
    }, 2000);
  });
}

// ── Share modal ───────────────────────────
function openShare() {
  shareModal.classList.remove('hidden');
  overlay.classList.remove('hidden');
  generateQR();
}

function closeShare() {
  shareModal.classList.add('hidden');
  overlay.classList.add('hidden');
}

// ── Filename auto-resize ───────────────────
function resizeFilename() {
  const tmp = document.createElement('span');
  tmp.style.cssText = 'position:absolute;visibility:hidden;font-family:"IM Fell English",Georgia,serif;font-style:italic;font-size:15px;white-space:pre';
  tmp.textContent = filenameInput.value || ' ';
  document.body.appendChild(tmp);
  filenameInput.style.width = (tmp.offsetWidth + 4) + 'px';
  document.body.removeChild(tmp);
}

// ── Tab key support ───────────────────────
editor.addEventListener('keydown', e => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const start = editor.selectionStart;
    const end   = editor.selectionEnd;
    editor.value = editor.value.slice(0, start) + '  ' + editor.value.slice(end);
    editor.selectionStart = editor.selectionEnd = start + 2;
  }
});

// ── Keyboard shortcuts ─────────────────────
document.addEventListener('keydown', e => {
  const mod = e.metaKey || e.ctrlKey;
  if (mod && e.key === 's') { e.preventDefault(); saveFile(); }
  if (mod && e.key === 'n') { e.preventDefault(); newFile(); }
  if (mod && e.key === 'o') { e.preventDefault(); openFile(); }
  if (mod && e.key === 'p') { e.preventDefault(); togglePreview(); }
  if (mod && e.key === '.') { e.preventDefault(); toggleFocus(); }
  if (e.key === 'Escape') {
    if (!shareModal.classList.contains('hidden')) closeShare();
    if (state.focusMode) toggleFocus();
  }
});

// ── Events ────────────────────────────────
editor.addEventListener('input', () => {
  updateStats();
  markModified();
  scheduleSave();
});

filenameInput.addEventListener('input', () => {
  resizeFilename();
  scheduleSave();
});

document.getElementById('btn-new').addEventListener('click', newFile);
document.getElementById('btn-open').addEventListener('click', openFile);
document.getElementById('btn-save').addEventListener('click', saveFile);
document.getElementById('btn-preview').addEventListener('click', togglePreview);
document.getElementById('btn-share').addEventListener('click', openShare);
document.getElementById('btn-focus').addEventListener('click', toggleFocus);
document.getElementById('share-close').addEventListener('click', closeShare);
document.getElementById('btn-dl-qr').addEventListener('click', downloadQR);
document.getElementById('btn-send-mail').addEventListener('click', openMail);
document.getElementById('btn-copy').addEventListener('click', copyToClipboard);
overlay.addEventListener('click', closeShare);

// ── Restore from localStorage ──────────────
(function init() {
  const saved  = localStorage.getItem('md_content');
  const fname  = localStorage.getItem('md_filename');
  if (saved !== null) {
    editor.value = saved;
    if (fname) filenameInput.value = fname;
  }
  updateStats();
  resizeFilename();
  editor.focus();
})();
