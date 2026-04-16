# md.

ミニマリスト Markdown エディタ。執筆に集中するためのシンプルなウェブアプリ。

## 機能

- **執筆集中** — フォーカスモードでUIを非表示
- **自動保存** — ブラウザのlocalStorageに自動保存（1.2秒後）
- **ファイル操作** — `.md`としてローカル保存・読み込み
- **プレビュー** — Markdownをリアルタイムレンダリング
- **QR共有** — QRコードで他デバイスに即転送
- **メール共有** — メールクライアントで送信
- **キーボードショートカット** — 快適な執筆体験

## ショートカット

| キー | 操作 |
|------|------|
| `⌘S` / `Ctrl+S` | ファイルを保存 |
| `⌘O` / `Ctrl+O` | ファイルを開く |
| `⌘N` / `Ctrl+N` | 新規作成 |
| `⌘P` / `Ctrl+P` | プレビュー切替 |
| `⌘.` / `Ctrl+.` | フォーカスモード切替 |
| `Esc` | モーダルを閉じる / フォーカス解除 |
| `Tab` | インデント（スペース2つ） |

## デプロイ方法

### GitHub + Netlify（推奨）

1. このリポジトリをGitHubにプッシュ
   ```bash
   git init
   git add .
   git commit -m "initial commit"
   git remote add origin https://github.com/YOUR_USERNAME/md-editor.git
   git push -u origin main
   ```

2. [Netlify](https://netlify.com) にログイン

3. **"Add new site" → "Import an existing project"** を選択

4. GitHubリポジトリを選択

5. ビルド設定は自動検出（`netlify.toml`が適用される）

6. **Deploy** — 数秒でライブに！

### 手動デプロイ（Netlify Drop）

[netlify.com/drop](https://app.netlify.com/drop) にフォルダごとドラッグ&ドロップするだけ。

## ファイル構成

```
md-editor/
├── index.html     # メインHTML
├── style.css      # スタイル（CSS変数でテーマ管理）
├── app.js         # アプリロジック
├── netlify.toml   # Netlify設定
└── README.md      # このファイル
```

## カスタマイズ

`style.css` の `:root` 変数を編集するだけでテーマを変更できます：

```css
:root {
  --bg:      #f5f2ed;  /* 背景色 */
  --ink:     #1a1814;  /* テキスト色 */
  --max-w:   680px;    /* エディタ最大幅 */
}
```
