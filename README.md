# ロボットガチャバトル

スマートフォンのブラウザで友達と遊ぶ 1 対 1 のオンライン対戦ゲーム。
各部位（ボディ・脚・武器・コア）を最大 5 回のガチャで組み立て、自分で操作して 90 秒の対戦を行う。
ガチャで捨てたパーツには戻れず、構成は 1 試合ごとに完結する。

## 技術スタック

TypeScript 6 / Vite 8 / Phaser 4.2 / Cloudflare Workers + Durable Objects（SQLite）/ Wrangler 4 / Vitest 5

単一の Worker が静的アセットと `/api/*` を同一オリジンで配信する。1 ルーム = 1 つの GameRoom Durable Object。

## セットアップ

Node 22 以上が必要（Volta を使っていれば package.json の設定で自動選択）。

```sh
npm install        # npm 10.8 で失敗する場合は npx npm@11 install
npm run dev        # http://localhost:5173 （LAN 上の端末からも接続可）
npm run check      # 型チェック・lint・整形確認・テスト
npm run build
npm run deploy     # ビルドして Cloudflare へデプロイ
```

## 開発コマンド

| コマンド                          | 内容                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------- |
| `npm run dev`                     | Vite + Cloudflare プラグインで Worker・DO をローカル実行                        |
| `npm run typecheck`               | `wrangler types` で Env 型を生成し、shared / client / server を個別に型チェック |
| `npm run lint` / `npm run format` | ESLint / Prettier                                                               |
| `npm test`                        | shared は Node、server は workerd（@cloudflare/vitest-plugin）で実行            |
| `npm run check`                   | 上記すべて。コミット前に通す                                                    |

## 2 クライアントでの検証

1. `npm run dev` を起動
2. ブラウザ A で `http://localhost:5173/?debug=1` を開き、名前を入れて「部屋を作る」
3. 表示された共有 URL（`/?room=XXXXXXXXXX`）をブラウザ B（別タブ、または LAN 上のスマホは `http://<PCのIP>:5173/?room=...`）で開き、「コードで参加」
4. 両者が「準備完了」でガチャ開始。4 部位を確定するか 120 秒で公開 → 3 秒カウントダウン → 対戦
5. `?debug=1` で右上に RTT・fps・snapshot 経過・snapshot サイズ・補正量を表示

PC の操作は WASD 移動、マウスで照準、左ボタンで射撃。スマホは画面左半分で移動、右半分で照準（倒している間は自動射撃）。

## デプロイ

```sh
npx wrangler login       # 初回のみ
npm run deploy
```

- `wrangler.jsonc` に Durable Object バインディング（`GAME_ROOM`）、SQLite クラスの migration、Rate Limiting（IP ごとに 60 秒 10 回）、静的アセット設定を記載
- 環境は当面 production のみ。staging を追加する場合は `env.staging` に `ratelimits` と `vars` を再記述する（DO バインディングと migrations はトップレベルを継承）
- 公開 URL は `https://robot-gacha-battle.<account>.workers.dev`

### 環境変数

| 変数                    | 用途                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------- |
| `EXTRA_ALLOWED_ORIGINS` | WebSocket の Origin 検証で、同一オリジン以外に許可する Origin（カンマ区切り）。通常は空 |

秘密情報は現時点で不要。将来追加する場合は `wrangler secret put` を使い、ソースに含めない。

## 構成

- `shared/` 純粋 TypeScript。`parts.ts`（パーツ定義と性能計算）、`arena.ts`（障害物とスポーン）、`simulation.ts`（移動・衝突・命中・勝敗）、`protocol.ts`（メッセージ型と検証）、`config.ts`（tick や制限時間）。ブラウザと DO の両方で使う
- `server/` `index.ts`（ルータ、Origin 検証、Rate Limiting）、`game-room.ts`（GameRoom DO）、`draft.ts`（ガチャ）、`battle-loop.ts`（30Hz ループ）
- `client/` Phaser scenes（Home / Room / Draft / Trial / Reveal / Battle / Result）、`net/`（API、WebSocket、状態管理）、`input/`（仮想スティック・キーボード）、`i18n/ja.ts`（文言）
- `tests/shared`、`tests/server`

## パーツの追加

1. `shared/parts.ts` の該当テーブル（`BODIES` / `LEGS` / `WEAPONS` / `CORES`）に ID と数値を追加し、ID の union 型にも加える
2. ガチャは各部位のテーブルから等確率で抽選するので、サーバー側の変更は不要
3. `tests/shared/parts.test.ts` の件数チェックを更新
4. 見た目はフェーズ4でアセット manifest に追加する（現在は図形）

## プロトコル概要

HTTP（すべて `Cache-Control: no-store`）

- `POST /api/rooms` `{ name }` → `{ roomCode, playerId, sessionToken, shareUrl }`
- `POST /api/rooms/:code/join` `{ name }` → 同上。満員 409、存在しない 404
- `GET /api/rooms/:code/socket` → WebSocket（Upgrade なしなら部屋あり 426 / なし 404）
- `GET /api/health`

WebSocket（JSON、`protocolVersion` / `matchId` / `type` を共通フィールド、サーバー送信は `serverTime` も含む）

- クライアント→サーバー: `authenticate` `ready` `draftDraw` `draftConfirm` `input` `rematch` `leave` `ping`
- サーバー→クライアント: `welcome` `draftResult` `roomState` `reveal` `snapshot` `result` `pong` `error`
- 接続後 5 秒以内に `authenticate { sessionToken }` が必要。同じ token の新接続は旧接続を置換する
- 詳細な型は `shared/protocol.ts`

状態遷移: WAITING → DRAFTING（120 秒）→ REVEAL（3 秒）→ COUNTDOWN（3 秒）→ BATTLE（90 秒）→ RESULT → 再戦で DRAFTING。

## 既知の制約

- Durable Object の配置ヒント `apac-ne` はベストエフォートで、日本近傍を保証しない
- 検証端末は iPhone Safari と PC Chrome。Android Chrome は未検証
- 見た目は図形のみ。ドット絵・音声はフェーズ4
- Phaser を含むクライアントは 1 チャンク約 1.4MB（gzip 約 360KB）
- ネットワーク断が続くと、サーバー側は 10 秒で切断負けにする（仕様どおり）
- ゲーム数値は初期値で、実機検証で調整する
- 本番デプロイ中の試合は中断され、無効試合として表示される

## ライセンス

MIT
