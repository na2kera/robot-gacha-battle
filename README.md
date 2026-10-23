# ロボットガチャバトル

スマートフォンのブラウザで友達と遊ぶ 1 対 1 のオンライン対戦ゲーム。
各部位最大 5 回のガチャでロボットを組み立て、自分で操作して戦う。

## 技術スタック

TypeScript / Vite / Phaser 4 / Cloudflare Workers + Durable Objects（SQLite）/ Wrangler

## セットアップ

```sh
npm install
npm run dev        # http://localhost:5173 （LAN からも接続可）
npm run check      # 型チェック・lint・整形確認・テスト
npm run build
npm run deploy     # Cloudflare へデプロイ
```

## 構成

- `client/` Phaser scenes、入力、通信、描画、UI
- `server/` Worker ルータ、GameRoom Durable Object
- `shared/` protocol、パーツ定義、シミュレーション、検証（純粋 TS）
- `public/assets/` 独自アセットと manifest
- `tests/shared` 素の Vitest、`tests/server` @cloudflare/vitest-plugin

## 既知の制約

- Durable Object の配置ヒント `apac-ne` はベストエフォートで、日本近傍を保証しない
- 検証端末は iPhone Safari と PC Chrome。Android Chrome は未検証
- ゲーム数値は初期値で、実機検証で調整する

## ライセンス

MIT
