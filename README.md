# AMALINK Translation

AMALINK Translation は、アクセスID制のリアルタイム翻訳Webアプリです。利用者は翻訳画面だけを使い、顧客名、契約プラン、利用残量、売上、原価などの管理情報は管理画面だけで扱います。

## 方針

- トライアルアカウントは自動発行しません。
- 管理者が顧客アカウントとアクセスIDを作成してから利用開始します。
- 利用者側には契約情報、残量、原価、売上を表示しません。
- 管理画面では顧客名、会社名/店舗名、担当者名、プラン、月額売上、利用量、粗利を確認できます。
- 会話本文、翻訳本文、音声、文字起こし本文は保存しません。保存対象は利用メタデータのみです。

## 画面

### 利用者画面

主なファイル:

- `index.html`
- `script.js`
- `styles.css`

主な機能:

- アクセスID/パスワードログイン
- 初回パスワード変更
- OpenAI Realtime API を使ったリアルタイム翻訳
- 翻訳セッション開始/停止
- Push-to-talk 設定
- セッション履歴表示
- quota/auth/error の日本語表示

### 管理画面

主なファイル:

- `admin/index.html`
- `admin/admin.js`
- `admin/admin.css`

主な機能:

- 管理者ログイン
- 顧客アカウント作成
- 顧客名、会社名/店舗名、担当者名の管理
- アクセスIDと初期パスワード発行
- Business Lite/Standard/Plus の割り当て
- 月額売上、利用量、推定API原価、粗利、原価率の確認
- アカウント停止/再開
- 追加分数と追加売上の登録

## 内部構造

```text
.
├── index.html                      # 利用者向け翻訳UI
├── script.js                       # 利用者UI、Realtime接続、履歴、設定
├── styles.css                      # 共通UI/利用者画面CSS
├── admin/
│   ├── index.html                  # 管理画面HTML
│   ├── admin.js                    # 管理画面ロジック
│   └── admin.css                   # 管理画面CSS
├── server.js                       # ローカルNode.jsサーバー/API互換実装
├── functions/api/[[path]].js       # Cloudflare Pages Functions 本番API
├── migrations/
│   └── 0001_b2b_usage.sql          # D1初期スキーマ
├── scripts/
│   ├── check-wrangler-config.js
│   └── smoke-business-rules.js
├── wrangler.toml                   # Cloudflare Pages/KV/D1/環境変数設定
└── package.json
```

## API

ローカルでは `server.js`、Cloudflare Pages では `functions/api/[[path]].js` がAPIを提供します。

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
| `/api/translation-sessions/start` | POST | 管理済み顧客アカウントの利用枠を確認して翻訳セッション開始 |
| `/api/realtime-token` | POST | OpenAI Realtime API 用の ephemeral token を発行 |
| `/api/translation-sessions/:id/heartbeat` | POST | 利用秒数、予約秒数、推定API原価を更新 |
| `/api/translation-sessions/:id/end` | POST | 翻訳セッションを終了 |

`/api/me/usage` は利用者側に契約情報を出さない方針のため 403 を返します。

### 管理

| Endpoint | Method | 概要 |
|---|---:|---|
| `/api/admin/users` | GET | アクセスID一覧と管理用顧客情報 |
| `/api/admin/users` | POST | 顧客アカウントとアクセスIDを作成 |
| `/api/admin/users/:id` | DELETE | アクセスID削除 |
| `/api/admin/accounts` | GET | 顧客アカウント別の利用状況 |
| `/api/admin/accounts/:id/status` | PATCH | アカウント停止/再開 |
| `/api/admin/accounts/:id/quota-adjustments` | POST | 追加分数と追加売上を登録 |

## データ構造

D1 の主なテーブル:

| Table | 役割 |
|---|---|
| `plans` | Business Lite/Standard/Plus などのプラン定義 |
| `accounts` | 顧客アカウント、顧客名、担当者名、状態、月額売上、原価単価 |
| `locations` | 店舗/拠点 |
| `account_users` | アクセスIDと顧客アカウントの紐付け |
| `usage_sessions` | 翻訳セッション単位の利用秒数、予約秒数、推定API原価 |
| `usage_events` | heartbeat/end などの利用イベント |
| `usage_daily_rollups` | 日別利用量の集計 |
| `quota_adjustments` | 追加分数と追加請求額 |
| `admin_audit_logs` | 管理操作ログ |

既存D1に顧客管理カラムがない場合は、管理API起動時に `customer_name`、`contact_name`、`memo`、`display_name` を安全に補完します。

## 収益性制御

翻訳開始時と heartbeat 時に以下を確認します。

- アカウントが `active` であること
- 月間利用上限を超えていないこと
- 日次利用上限を超えていないこと
- 同時接続数を超えていないこと
- 推定API原価率が上限を超えていないこと
- 1回のセッション時間上限を超えていないこと

主な内部エラーコード:

| Code | 意味 |
|---|---|
| `monthly_quota_exhausted` | 月間上限到達 |
| `daily_quota_exhausted` | 日次上限到達 |
| `concurrent_limit` | 同時接続上限到達 |
| `cost_ratio_stop` | 原価率上限到達 |
| `account_suspended` | アカウント停止中 |
| `password_change_required` | パスワード変更必須 |

## ローカル起動

```bash
npm install
npm start
```

標準URL:

```text
http://localhost:3000
```

別ポートで起動する場合:

```bash
$env:PORT=4000; npm start
```

## 検証

```bash
npm run check
npm run demo:check
```
