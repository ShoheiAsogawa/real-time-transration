# AMALINK Translation

ブラウザで動く、招待 ID 制の多言語リアルタイム翻訳 Web アプリです。

## ローカル起動

`.env.example` を参考に `.env` を設定してから、以下のコマンドで起動します。

```bash
npm start
```

既定では `http://localhost:3000` で開けます。

## Cloudflare Pages

静的ファイルを Pages で配信し、`/api/*` を Pages Functions で処理します。  
セッションは KV バインディング `SESSION_KV` に保存します。

### ローカルで Cloudflare Pages Functions として起動する場合

```bash
cp .dev.vars.example .dev.vars   # 値を書き換えてから実行
npm run cf:dev
```

### Cloudflare 側で必要な設定

| 設定 | 種別 | 説明 |
|------|------|------|
| `OPENAI_API_KEY` | secret | OpenAI API キー |
| `SESSION_SECRET` | secret | セッション Cookie 署名用ランダム文字列（32 バイト以上） |
| `SESSION_KV` | KV バインド | セッション・ユーザー情報の永続化 |
| `ALLOWED_LOGIN_IDS` | 環境変数 | ログインを許可するアクセス ID（カンマ区切り） |
| `SEED_USER_PASSWORD_HASH` | secret | シードユーザーの初期パスワードハッシュ |
| `ADMIN_EMAIL` | 環境変数 | 管理者メールアドレス |
| `ADMIN_PASSWORD_HASH` | secret | 管理者パスワードハッシュ |
| `ALLOWED_LOGIN_ID_HASHES` | 環境変数 | プレーンテキスト ID の代わりに SHA-256 ハッシュを使う場合 |
| `OPENAI_REALTIME_MODEL` | 環境変数 | Realtime API のモデル名（省略可） |
| `PASSWORD_PEPPER` | secret | KV 漏洩時のパスワードハッシュ追加保護（省略可） |

## 構文チェック

```bash
npm run check
```

## npm スクリプト一覧

| コマンド | 説明 |
|---------|------|
| `npm start` | ローカル Node.js サーバー起動 |
| `npm run cf:dev` | Wrangler Pages ローカル起動 |
| `npm run cf:deploy` | Cloudflare Pages へデプロイ |
| `npm run check` | JS ファイルの構文チェック |
| `npm run hash-id -- <ID>` | アクセス ID の SHA-256 ハッシュを生成 |
| `npm run hash-password -- <PASSWORD>` | パスワードの PBKDF2 ハッシュを生成 |

## 主な設定変数

| 変数 | 説明 |
|------|------|
| `OPENAI_API_KEY` | OpenAI API キー |
| `SESSION_SECRET` | セッション Cookie 署名用のランダム文字列 |
| `ALLOWED_LOGIN_IDS` | ログインを許可するアクセス ID |
| `ALLOWED_LOGIN_ID_HASHES` | アクセス ID を平文で置かない場合の SHA-256 ハッシュ |
| `SEED_USER_PASSWORD_HASH` | シードユーザーの初期パスワードハッシュ |
| `ADMIN_EMAIL` | 管理者のメールアドレス |
| `ADMIN_PASSWORD_HASH` | 管理者パスワードのハッシュ |
| `OPENAI_REALTIME_MODEL` | Realtime API のモデル名 |
| `PORT` | Web サーバーのポート（ローカルのみ） |
