# robot-gacha-battle

ロボットガチャバトル。スマホブラウザで友達と 1 対 1 のオンライン対戦。
仕様は `docs/spec.md`、設計判断は `docs/decisions.md` を正とする（`docs/` は非公開、git 管理外）。

## 技術スタック（変更禁止）

TypeScript 6.0 / Vite 8 / Phaser 4.2 / Cloudflare Workers + Durable Objects（SQLite）/ Wrangler 4 / @cloudflare/vite-plugin / Vitest 5 + @cloudflare/vitest-plugin / Node 22.13（Volta pin）/ npm。
UI フレームワークは使わない。Colyseus・外部 DB・外部ホスティングは使わない。

## 構成

- `shared/` 純粋 TS。protocol、パーツ定義、性能計算、シミュレーション、検証。Phaser・DOM・Workers API に依存しない。必ずテストを付ける
- `server/` Worker ルータ、GameRoom Durable Object、認証、保存。Phaser を使わない
- `client/` Phaser scenes、タッチ入力、通信、描画、UI。文言は 1 ファイルに集約（日本語のみ）
- `public/assets/` 独自アセットと manifest
- `tests/shared` 素の Vitest、`tests/server` @cloudflare/vitest-plugin

依存方向は client → shared、server → shared の一方向。shared から他層を参照しない。

## ルール

- ガチャレーシングの名称・画像・音楽・固有パーツを流用しない。アセットは独自制作
- ゲーム数値（HP、速度、ダメージ等）は `shared/` のデータに置き、ロジックにハードコードしない
- クライアントから座標・ダメージを受け付けない。乱数はサーバーの暗号学的乱数のみ
- 公開前の相手の候補・構成を送信しない
- sessionToken・認証メッセージ・入力全文をログに残さない
- `npm run check` が通ってからコミット。コミットは指示を受けてから
- この環境では PATH 上の `python3`（mise/rye のシム）が固まる。Python を使うときは `/opt/homebrew/bin/python3` を直接指定し、npm install が node-gyp で止まる場合は `npm_config_python=/opt/homebrew/bin/python3` を設定する。npm 10.8 は vitest の peer 解決で落ちるため、依存の追加・更新は `npx npm@11 install ...` で行う

## 役割

設計・レビュー Fable、実装 Opus サブエージェント、レビューに Codex 併用。

## 検証端末

iPhone Safari と PC Chrome。Android は未検証。
