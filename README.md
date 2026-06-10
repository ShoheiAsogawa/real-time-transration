# AMALINK Translation

AMALINK Translation は、アクセスID制の多言語リアルタイム翻訳 Web アプリです。
ブラウザだけで音声翻訳を開始でき、B2B向けに利用分数、同時接続、原価率、停止状態を管理できます。

## 何をするシステムか

- 利用者はアクセスIDとパスワードでログインします。
- 翻訳画面でマイクを開始すると、OpenAI Realtime API 用の一時トークンを取得します。
- 翻訳セッション開始時に利用枠を予約し、heartbeat で利用秒数と推定API原価を積み上げます。
- 管理者はユーザー発行、契約アカウントの利用量確認、停止/再開、追加分数付与を行えます。
- 会話本文、翻訳本文、音声、文字起こし本文は保存しません。保存対象は利用メタデータのみです。

## 画面

### 利用者画面

- `index.html`
- `script.js`
- `styles.css`

主な機能:

- アクセスID/パスワードログイン
- 初回パスワード変更
- リアルタイム翻訳開始/停止
- Push-to-talk 設定
- ダークモード設定
- セッション履歴表示
- AI翻訳の注意文表示
- quota/auth/error の自然な日本語表示

### 管理画面

- `admin/index.html`
- `admin/admin.js`
- `admin/admin.css`

主な機能:

- 管理者ログイン
- ユーザー一覧
- アクセスID発行
- 初期パスワード生成
- IDコピー
- ユーザー削除
- 契約アカウント別の利用量確認
- 月額売上、追加売上、合計売上、推定API原価、粗利、原価率表示
- アカウント停止/再開
- 追加分数付与
- スマホ/PC対応の管理ダッシュボード

## 内部構造

```text
.
├── index.html                      # 利用者向け翻訳UI
├── script.js                       # 利用者UI、Realtime接続、履歴、設定
├── styles.css                      # 共通UI/翻訳画面/ログイン画面CSS
├── admin/
│   ├── index.html                  # 管理画面HTML
│   ├── admin.js                    # 管理画面ロジック
│   └── admin.css                   # 管理画面CSS
├── server.js                       # ローカルNode.jsサーバー/API互換実装
├── functions/api/[[path]].js       # Cloudflare Pages Functions 本番API
├── migrations/0001_b2b_usage.sql   # D1スキーマ
├── scripts/
│   ├── check-wrangler-config.js    # wrangler設定チェック
│   └── smoke-business-rules.js     # 事業ルールのスモークテスト
├── wrangler.toml                   # Cloudflare Pages/KV/D1/環境変数設定
└── package.json                    # npm scripts
```

## API構造

ローカルでは `server.js`、Cloudflare Pages では `functions/api/[[path]].js` が同等のAPIを提供します。

### 認証/セッション

| Endpoint | Method | 概要 |
|---|---:|---|
| `/api/me` | GET | ログイン中ユーザーを返す |
| `/api/login` | POST | 利用者ログイン |
| `/api/admin/login` | POST | 管理者ログイン |
| `/api/logout` | POST | ログアウト |
| `/api/password` | POST | 利用者パスワード変更 |

### 翻訳/利用量

| Endpoint | Method | 概要 |
|---|---:|---|
| `/api/translation-sessions/start` | POST | 利用枠を確認し翻訳セッションを開始 |
| `/api/realtime-token` | POST | OpenAI Realtime API 用の ephemeral token を発行 |
| `/api/translation-sessions/:id/heartbeat` | POST | 利用秒数、予約秒数、推定原価を更新 |
| `/api/translation-sessions/:id/end` | POST | 翻訳セッションを終了 |
| `/api/me/usage` | GET | 利用者自身の残り利用量を取得 |

### 管理

| Endpoint | Method | 概要 |
|---|---:|---|
| `/api/admin/users` | GET | ユーザー一覧 |
| `/api/admin/users` | POST | ユーザー作成 |
| `/api/admin/users/:id` | DELETE | ユーザー削除 |
| `/api/admin/accounts` | GET | 契約アカウント利用状況 |
| `/api/admin/accounts/:id/status` | PATCH | アカウント停止/再開 |
| `/api/admin/accounts/:id/quota-adjustments` | POST | 追加分数と追加売上を登録 |

## データ構造

D1 のスキーマは `migrations/0001_b2b_usage.sql` にあります。

主要テーブル:

| Table | 役割 |
|---|---|
| `plans` | Free/Lite/Standard/Plus などのプラン定義 |
| `accounts` | 契約アカウント、業種、状態、月額売上、原価単価 |
| `locations` | 店舗/拠点 |
| `account_users` | アクセスIDと契約アカウントの紐付け |
| `usage_sessions` | 翻訳セッション単位の利用秒数、予約秒数、推定原価 |
| `usage_events` | heartbeat/end などの利用イベント |
| `usage_daily_rollups` | 日別利用量の集計 |
| `quota_adjustments` | 追加分数と追加請求額 |
| `admin_audit_logs` | 管理操作ログ |

## 利用量制御と黒字化ロジック

翻訳開始時と heartbeat 時に以下を確認します。

- アカウントが `active` か
- 月間利用上限を超えていないか
- 日次利用上限を超えていないか
- 同時接続数を超えていないか
- 推定API原価率が上限を超えていないか
- 1回のセッション時間上限を超えていないか

内部エラーコード:

| Code | 意味 |
|---|---|
| `monthly_quota_exhausted` | 月間上限到達 |
| `daily_quota_exhausted` | 日次上限到達 |
| `concurrent_limit` | 同時接続上限到達 |
| `cost_ratio_stop` | 原価率上限到達 |
| `account_suspended` | アカウント停止中 |
| `password_change_required` | パスワード変更必須 |

これらのコードは内部制御用に維持し、画面表示直前に日本語メッセージへ変換します。

## 保存しないデータ

以下の本文系データは保存対象外です。

- 会話本文
- 翻訳本文
- 音声
- 文字起こし本文
- メッセージ配列
- メディアpayload

API 側では `rejectContentPayload` / `requireAllowedPayload` により、本文系payloadが利用メタデータ保存APIに入らないようにしています。

保存するもの:

- 利用分数/秒数
- 開始/終了/heartbeat日時
- アカウントID
- 拠点ID
- ユーザーID
- 推定API原価
- stop reason
- 管理操作ログ

## ローカル起動

```bash
npm install
npm start
```

既定では以下で開きます。

```text
http://localhost:3000
```

別ポートで起動する場合:

```powershell
$env:PORT='4000'; npm start
```

## Cloudflare Pages

静的ファイルは Pages で配信し、`/api/*` は Pages Functions で処理します。

必要な binding:

- `SESSION_KV`: セッション、ユーザー設定、レート制限、端末紐付け用
- `DB`: D1。B2B usage gate、利用量、原価、quota、監査ログ用

`wrangler.toml` では以下が設定されています。

```toml
[[kv_namespaces]]
binding = "SESSION_KV"

[[d1_databases]]
binding = "DB"
database_name = "lingualive-b2b-usage"
```

D1 migration:

```bash
npx wrangler d1 migrations apply lingualive-b2b-usage
```

Cloudflare Pages の管理画面でも、Functions の D1 bindings に `DB` を設定してください。

## 主な環境変数

| 変数 | 種別 | 説明 |
|---|---|---|
| `OPENAI_API_KEY` | secret | OpenAI Realtime API 用キー |
| `SESSION_SECRET` | secret | セッションCookie署名用ランダム文字列 |
| `SESSION_KV` | binding | Cloudflare KV binding |
| `DB` | binding | Cloudflare D1 binding |
| `ALLOWED_LOGIN_IDS` | env | ログイン許可ID。カンマ区切り |
| `ALLOWED_LOGIN_ID_HASHES` | env | アクセスIDを平文で置かない場合の SHA-256 hash |
| `SEED_USER_PASSWORD_HASH` | secret | シードユーザー初期パスワードhash |
| `ADMIN_EMAIL` | env | 管理者メールアドレス |
| `ADMIN_PASSWORD_HASH` | secret | 管理者パスワードhash |
| `OPENAI_REALTIME_MODEL` | env | Realtime API model。既定は `gpt-realtime` |
| `PASSWORD_PEPPER` | secret | パスワードhash追加保護 |
| `PASSWORD_MAX_ATTEMPTS` | env | パスワード変更試行上限 |
| `AUTH_MAX_ATTEMPTS` | env | ログイン試行上限 |
| `AUTH_WINDOW_MS` | env | レート制限の時間窓 |
| `PORT` | local | ローカルNode.jsサーバーのポート |

## パスワードhash生成

```bash
npm run hash-password -- <PASSWORD>
```

アクセスID hash生成:

```bash
npm run hash-id -- <ACCESS_ID>
```

## チェック

構文と設定チェック:

```bash
npm run check
```

事業ルールのスモークテスト込み:

```bash
npm run demo:check
```

`demo:check` では以下を確認します。

- 薬局向け metadata-only 制約
- Free/Lite プラン上限
- 本文payload拒否キー
- heartbeat/end payload allowlist
- stale session cleanup
- start 時の 60秒予約
- wrangler D1 placeholder 設定の検出

## npm scripts

| Command | 内容 |
|---|---|
| `npm start` | ローカル Node.js サーバー起動 |
| `npm run dev` | `npm start` と同じ |
| `npm run check` | JS構文チェック + wrangler設定チェック |
| `npm run demo:check` | `check` + 事業ルールスモークテスト |
| `npm run cf:dev` | Wrangler Pages ローカル起動 |
| `npm run cf:deploy` | Cloudflare Pages へデプロイ |
| `npm run hash-id -- <ID>` | アクセスIDの SHA-256 hash生成 |
| `npm run hash-password -- <PASSWORD>` | PBKDF2 password hash生成 |

## 実装上の注意

- quota/auth の内部エラーコードは日本語に置き換えないでください。
- 日本語表示はフロント側の表示マップで行います。
- 本文、翻訳本文、音声、文字起こし本文をDBへ保存しないでください。
- 管理画面の追加分数は `quota_adjustments` に保存され、追加売上は原価率計算に反映されます。
- ローカルの `server.js` は D1 の代わりにインメモリで互換動作します。本番永続化は Cloudflare D1 側です。
- 本番では `OPENAI_API_KEY`, `SESSION_SECRET`, `ADMIN_PASSWORD_HASH`, `SEED_USER_PASSWORD_HASH`, `PASSWORD_PEPPER` を secret として設定してください。
