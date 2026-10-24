/** Validate decoded PNGs rather than trusting generator dimensions. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { format } from 'prettier';
process.env.MAGICK_THREAD_LIMIT = '1';
const root = fileURLToPath(new URL('../../', import.meta.url));
const dir = path.join(root, 'public/img');
const manifest = JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const source = readFileSync(path.join(root, 'shared/parts.ts'), 'utf8');
const ids = [...source.matchAll(/id: '(\w+)'/g)].map((m) => m[1]);
const sizes = {};
for (const id of ids) {
  sizes[`td_${id}_blue`] = [id.startsWith('weapon_') ? 64 : 48, 48];
  sizes[`td_${id}_red`] = [id.startsWith('weapon_') ? 64 : 48, 48];
  sizes[`part_${id}`] = [96, 96];
  if (id.startsWith('weapon_')) sizes[`bullet_${id}`] = [12, 12];
}
Object.assign(sizes, {
  dummy: [48, 48],
  capsule_closed: [128, 128],
  capsule_open: [128, 128],
  icon_body: [32, 32],
  icon_legs: [32, 32],
  icon_weapon: [32, 32],
  icon_core: [32, 32],
  logo: [640, 200],
  tile_floor: [32, 32],
  tile_wall: [32, 32],
  stamp_win: [128, 128],
});
assert.deepEqual(Object.keys(manifest.images).sort(), Object.keys(sizes).sort());
assert.deepEqual(
  readdirSync(dir)
    .filter((x) => x.endsWith('.png'))
    .sort(),
  Object.keys(sizes)
    .map((x) => `${x}.png`)
    .sort(),
);
const rows = [];
const decoded = new Map();
for (const [key, expected] of Object.entries(sizes)) {
  assert.equal(manifest.images[key], `img/${key}.png`);
  const file = path.join(dir, `${key}.png`),
    bytes = readFileSync(file);
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  assert.deepEqual([width, height], expected, key);
  const raw = execFileSync('magick', [file, '-depth', '8', 'rgba:-']);
  decoded.set(key, { raw, width, height });
  assert.equal(raw.length, width * height * 4);
  let left = width,
    top = height,
    right = -1,
    bottom = -1,
    transparent = 0,
    partial = 0;
  const colors = new Set();
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4,
        a = raw[i + 3];
      if (a === 0) {
        transparent++;
        continue;
      }
      if (a !== 255) partial++;
      colors.add(raw.subarray(i, i + 4).toString('hex'));
      left = Math.min(left, x);
      right = Math.max(right, x);
      top = Math.min(top, y);
      bottom = Math.max(bottom, y);
    }
  const row = {
    key,
    width,
    height,
    colors: colors.size,
    transparentPixels: transparent,
    partialAlphaPixels: partial,
    alphaBounds: [left, top, right + 1, bottom + 1],
  };
  if (!key.startsWith('tile_')) assert(transparent > 0, `${key}: transparent background required`);
  if (key !== 'logo') {
    if (!key.startsWith('capsule_')) assert.equal(partial, 0, `${key}: pixel art alpha`);
    assert(colors.size <= 16, `${key}: limited palette`);
  }
  const match = key.match(/^td_(body_\w+)_(blue|red)$/);
  if (match) {
    const radii = { body_light: 16, body_standard: 19, body_heavy: 23 };
    const radius = radii[match[1]],
      diameter = radius * 2;
    assert.deepEqual([right - left + 1, bottom - top + 1], [diameter, diameter], key);
    assert.deepEqual(
      [left, top, right + 1, bottom + 1],
      [24 - radius, 24 - radius, 24 + radius, 24 + radius],
      key,
    );
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        if (raw[(y * width + x) * 4 + 3]) {
          assert(
            (x + 0.5 - 24) ** 2 + (y + 0.5 - 24) ** 2 <= radius ** 2,
            `${key}: pixel outside collision circle`,
          );
        }
    row.bodyDiameter = [diameter, diameter];
    row.bodyCenter = [24, 24];
  }
  if (key.startsWith('td_weapon_')) {
    const overhang = right + 1 - 47;
    assert(overhang >= 8 && overhang <= 12, `${key}: heavy-body barrel overhang`);
    row.heavyBodyOverhang = overhang;
    row.anchor = [24, 24];
  }
  if (key.startsWith('td_core_')) {
    row.emblemSize = [right - left + 1, bottom - top + 1];
    assert(right - left + 1 >= 10 && right - left + 1 <= 12);
    assert(bottom - top + 1 >= 10 && bottom - top + 1 <= 12);
  }
  if (key.startsWith('capsule_')) {
    assert(partial > 500, `${key}: translucent upper shell`);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        const rgb = raw.subarray(i, i + 3).toString('hex');
        assert(
          !['4c8dff', '2956a8', 'a8d3ff', 'ff5c5c', 'aa354b', 'ffb4a3'].includes(rgb),
          `${key}: no team colors`,
        );
        if (y >= (key === 'capsule_open' ? 88 : 72) && raw[i + 3])
          assert.equal(raw[i + 3], 255, `${key}: opaque lower bowl`);
        if (key === 'capsule_open' && y >= 50 && y < 72)
          assert.equal(raw[i + 3], 0, `${key}: separated shells`);
      }
  }
  if (key.startsWith('tile_')) {
    assert.equal(transparent, 0);
    for (let n = 0; n < 32; n++) {
      assert(
        raw
          .subarray(n * 4, n * 4 + 4)
          .equals(raw.subarray((31 * 32 + n) * 4, (31 * 32 + n) * 4 + 4)),
        `${key}: top/bottom seam`,
      );
      assert(
        raw
          .subarray(n * 32 * 4, n * 32 * 4 + 4)
          .equals(raw.subarray((n * 32 + 31) * 4, (n * 32 + 31) * 4 + 4)),
        `${key}: left/right seam`,
      );
    }
  }
  rows.push(row);
}
const preview = readFileSync(path.join(root, 'docs/screens/assets-preview.png'));
assert.deepEqual([preview.readUInt32BE(16), preview.readUInt32BE(20)], [2448, 3744]);
// Weapons are the last layer: ensure none of their pixels cover the central emblems.
for (const team of ['blue', 'red'])
  for (const core of ids.filter((x) => x.startsWith('core_')))
    for (const weapon of ids.filter((x) => x.startsWith('weapon_'))) {
      const emblem = decoded.get(`td_${core}_${team}`),
        gun = decoded.get(`td_${weapon}_${team}`);
      for (let y = 0; y < 48; y++)
        for (let x = 0; x < 48; x++)
          assert(
            !(emblem.raw[(y * 48 + x) * 4 + 3] && gun.raw[(y * 64 + x) * 4 + 3]),
            `${core}/${weapon}: emblem occlusion`,
          );
    }
const report = {
  assetCount: rows.length,
  assembledPreview: { width: 2448, height: 3744, scale: 4, loadoutsPerTeam: 81, teams: 2 },
  assets: rows,
};
writeFileSync(
  path.join(root, 'scripts/assets/measurements.json'),
  await format(JSON.stringify(report), { parser: 'json' }),
);
console.log(
  `PASS: ${rows.length} PNGs; manifest, sizes, alpha, palettes, body diameters, 8–12px heavy-body barrel overhang, unobscured core emblems, translucent capsules with separated shells, tile seams, 162 previews.`,
);
