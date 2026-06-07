# LinguaLive

ブラウザで動く、招待 ID 制のリアルタイム日英翻訳 Web アプリです。

## 起動

1. `.env.example` を参考に `.env` を設定します。
2. 次のコマンドで起動します。

```bash
npm start
```

既定では `http://localhost:3000` で開けます。

## Cloudflare Pages

Cloudflare では静的ファイルを Pages で配信し、`/api/*` を Pages Functions で処理します。
セッションは KV バインディング `SESSION_KV` に保存します。

ローカルで Cloudflare Pages Functions として起動する場合:

```bash
copy .dev.vars.example .dev.vars
npm run cf:dev
```

Cloudflare 側で必要な設定:

- KV namespace を作成し、`SESSION_KV` としてバインド
- `OPENAI_API_KEY` を secret として設定
- `SESSION_SECRET` を secret として設定
- `ALLOWED_LOGIN_IDS` または `ALLOWED_LOGIN_ID_HASHES` を環境変数として設定
- `OPENAI_REALTIME_MODEL` を必要に応じて設定

## 確認

```bash
npm run check
```

## 主な設定

- `OPENAI_API_KEY`: OpenAI API キー
- `SESSION_SECRET`: セッション Cookie 署名用のランダム文字列
- `ALLOWED_LOGIN_IDS`: ログインを許可するアクセス ID
- `ALLOWED_LOGIN_ID_HASHES`: アクセス ID を平文で置かない場合の SHA-256 ハッシュ
- `OPENAI_REALTIME_MODEL`: Realtime API のモデル名
- `PORT`: Web サーバーのポート
