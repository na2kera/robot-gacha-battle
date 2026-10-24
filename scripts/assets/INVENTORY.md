# U8 作成ファイル一覧

PNG の値は `verify.mjs` が最終ファイルをデコードして実測したもの。

| ファイル                                  | 実測サイズ |
| ----------------------------------------- | ---------- |
| public/img/td_body_light_blue.png         | 48×48px    |
| public/img/td_body_light_red.png          | 48×48px    |
| public/img/part_body_light.png            | 96×96px    |
| public/img/part_body_light_red.png        | 96×96px    |
| public/img/td_body_standard_blue.png      | 48×48px    |
| public/img/td_body_standard_red.png       | 48×48px    |
| public/img/part_body_standard.png         | 96×96px    |
| public/img/part_body_standard_red.png     | 96×96px    |
| public/img/td_body_heavy_blue.png         | 48×48px    |
| public/img/td_body_heavy_red.png          | 48×48px    |
| public/img/part_body_heavy.png            | 96×96px    |
| public/img/part_body_heavy_red.png        | 96×96px    |
| public/img/td_legs_hover_blue.png         | 48×48px    |
| public/img/td_legs_hover_red.png          | 48×48px    |
| public/img/part_legs_hover.png            | 96×96px    |
| public/img/part_legs_hover_red.png        | 96×96px    |
| public/img/td_legs_biped_blue.png         | 48×48px    |
| public/img/td_legs_biped_red.png          | 48×48px    |
| public/img/part_legs_biped.png            | 96×96px    |
| public/img/part_legs_biped_red.png        | 96×96px    |
| public/img/td_legs_tank_blue.png          | 48×48px    |
| public/img/td_legs_tank_red.png           | 48×48px    |
| public/img/part_legs_tank.png             | 96×96px    |
| public/img/part_legs_tank_red.png         | 96×96px    |
| public/img/td_weapon_machinegun_blue.png  | 64×48px    |
| public/img/td_weapon_machinegun_red.png   | 64×48px    |
| public/img/part_weapon_machinegun.png     | 96×96px    |
| public/img/part_weapon_machinegun_red.png | 96×96px    |
| public/img/bullet_weapon_machinegun.png   | 12×12px    |
| public/img/td_weapon_cannon_blue.png      | 64×48px    |
| public/img/td_weapon_cannon_red.png       | 64×48px    |
| public/img/part_weapon_cannon.png         | 96×96px    |
| public/img/part_weapon_cannon_red.png     | 96×96px    |
| public/img/bullet_weapon_cannon.png       | 12×12px    |
| public/img/td_weapon_shotgun_blue.png     | 64×48px    |
| public/img/td_weapon_shotgun_red.png      | 64×48px    |
| public/img/part_weapon_shotgun.png        | 96×96px    |
| public/img/part_weapon_shotgun_red.png    | 96×96px    |
| public/img/bullet_weapon_shotgun.png      | 12×12px    |
| public/img/td_core_vital_blue.png         | 48×48px    |
| public/img/td_core_vital_red.png          | 48×48px    |
| public/img/part_core_vital.png            | 96×96px    |
| public/img/part_core_vital_red.png        | 96×96px    |
| public/img/td_core_boost_blue.png         | 48×48px    |
| public/img/td_core_boost_red.png          | 48×48px    |
| public/img/part_core_boost.png            | 96×96px    |
| public/img/part_core_boost_red.png        | 96×96px    |
| public/img/td_core_power_blue.png         | 48×48px    |
| public/img/td_core_power_red.png          | 48×48px    |
| public/img/part_core_power.png            | 96×96px    |
| public/img/part_core_power_red.png        | 96×96px    |
| public/img/dummy.png                      | 48×48px    |
| public/img/capsule_closed.png             | 128×128px  |
| public/img/capsule_open.png               | 128×128px  |
| public/img/icon_body.png                  | 32×32px    |
| public/img/icon_legs.png                  | 32×32px    |
| public/img/icon_weapon.png                | 32×32px    |
| public/img/icon_core.png                  | 32×32px    |
| public/img/logo.png                       | 640×200px  |
| public/img/tile_floor.png                 | 32×32px    |
| public/img/tile_wall.png                  | 32×32px    |
| public/img/stamp_win.png                  | 128×128px  |

補助ファイル:

- `public/img/manifest.json`: 画像キーとパス（62 件）
- `scripts/assets/generate.mjs`: 画像生成・加工・合成プレビュー生成
- `scripts/assets/generate-red-parts.mjs`: 共通チームパレットと赤い正面パーツの生成
- `scripts/assets/verify.mjs`: 出力の検証と実測レポート生成
- `scripts/assets/measurements.json`: 全画像の実測値
- `scripts/assets/README.md`: 再生成手順と設計説明
- `scripts/assets/INVENTORY.md`: このファイル
- `scripts/assets/source/concept-prompt.txt`: 組み込み画像生成ツールに渡したプロンプト
- `scripts/assets/source/concept.png`: 生成した造形案（1536×1024px）
- `scripts/assets/source/logo.svg`: 日本語の正確な文字組みを持つロゴ原稿
- `docs/screens/assets-preview.png`: 全162構成、4倍、2448×3744px
- `docs/screens/assets-catalog.png`: ロゴ以外の49点、1152×1120px

追加の造形検討資料:

- `scripts/assets/source/capsule-revision-concept.png`: カプセル修正案（1536×1024px）
- `scripts/assets/source/capsule-revision-prompt.txt`: カプセル修正案の生成プロンプト
