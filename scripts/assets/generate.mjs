/** Original capsule-workshop sprites. Integer raster geometry; no runtime dependencies. */
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

process.env.MAGICK_THREAD_LIMIT = '1';

const root = fileURLToPath(new URL('../../', import.meta.url));
const out = path.join(root, 'public/img');
mkdirSync(out, { recursive: true });
mkdirSync(path.join(root, 'docs/screens'), { recursive: true });
const ink = '#172333',
  metal = '#3C5068',
  lightMetal = '#647B94';
const cream = '#FFF3DC',
  gold = '#FFD166',
  goldDark = '#BB7836';
const palettes = {
  blue: { main: '#4C8DFF', dark: '#2956A8', hi: '#A8D3FF' },
  red: { main: '#FF5C5C', dark: '#AA354B', hi: '#FFB4A3' },
};
class Raster {
  constructor(w, h = w) {
    this.w = w;
    this.h = h;
    this.data = Buffer.alloc(w * h * 4);
  }
  pixel(x, y, c, alpha = 255) {
    if (x < 0 || x >= this.w || y < 0 || y >= this.h) return;
    const n = parseInt(c.slice(1), 16),
      i = (y * this.w + x) * 4;
    this.data.set([n >> 16, (n >> 8) & 255, n & 255, alpha], i);
  }
  rect(x, y, w, h, c, alpha = 255) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.pixel(i, j, c, alpha);
  }
  ellipse(cx, cy, rx, ry, c, alpha = 255) {
    for (let y = Math.floor(cy - ry); y < cy + ry; y++)
      for (let x = Math.floor(cx - rx); x < cx + rx; x++)
        if (((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2 <= 1)
          this.pixel(x, y, c, alpha);
  }
  poly(points, c) {
    for (let y = 0; y < this.h; y++)
      for (let x = 0; x < this.w; x++) {
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          const [a, b] = points[i],
            [d, e] = points[j];
          if (b > y + 0.5 !== e > y + 0.5 && x + 0.5 < ((d - a) * (y + 0.5 - b)) / (e - b) + a)
            inside = !inside;
        }
        if (inside) this.pixel(x, y, c);
      }
  }
  box(x, y, w, h, c) {
    this.rect(x, y, w, h, ink);
    this.rect(x + 1, y + 1, w - 2, h - 2, c);
  }
  blit(src, x, y, scale = 1) {
    for (let j = 0; j < src.h; j++)
      for (let i = 0; i < src.w; i++) {
        const k = (j * src.w + i) * 4;
        const sourceAlpha = src.data[k + 3];
        if (sourceAlpha === 255)
          this.rect(
            x + i * scale,
            y + j * scale,
            scale,
            scale,
            `#${src.data.subarray(k, k + 3).toString('hex')}`,
          );
        else if (sourceAlpha > 0) {
          // Source-over keeps real translucency in PNGs and composites it for review sheets.
          for (let dy = 0; dy < scale; dy++)
            for (let dx = 0; dx < scale; dx++) {
              const px = x + i * scale + dx,
                py = y + j * scale + dy;
              if (px < 0 || py < 0 || px >= this.w || py >= this.h) continue;
              const target = (py * this.w + px) * 4;
              const sa = sourceAlpha / 255,
                da = this.data[target + 3] / 255;
              const alpha = sa + da * (1 - sa);
              for (let channel = 0; channel < 3; channel++)
                this.data[target + channel] = Math.round(
                  (src.data[k + channel] * sa + this.data[target + channel] * da * (1 - sa)) /
                    alpha,
                );
              this.data[target + 3] = Math.round(alpha * 255);
            }
        }
      }
  }
  save(filename) {
    const temporary = mkdtempSync(path.join(tmpdir(), 'robot-assets-'));
    const raw = path.join(temporary, 'pixels.rgba');
    writeFileSync(raw, this.data);
    try {
      execFileSync(
        'magick',
        [
          '-size',
          `${this.w}x${this.h}`,
          '-depth',
          '8',
          `rgba:${raw}`,
          '-strip',
          '-define',
          'png:color-type=6',
          filename,
        ],
        { timeout: 15000 },
      );
    } finally {
      rmSync(temporary, { recursive: true });
    }
  }
}
const images = {},
  rasters = new Map();
function save(key, r) {
  console.log(`Writing ${key}`);
  images[key] = `img/${key}.png`;
  rasters.set(key, r);
  r.save(path.join(out, `${key}.png`));
}
const bodySizes = { body_light: 32, body_standard: 38, body_heavy: 46 };
const ids = [
  ...readFileSync(path.join(root, 'shared/parts.ts'), 'utf8').matchAll(/id: '(\w+)'/g),
].map((m) => m[1]);
if (ids.length !== 12 || new Set(ids).size !== 12)
  throw Error('Review shared/parts.ts: expected 12 unique part definitions');

function top(id, team) {
  const r = new Raster(id.startsWith('weapon_') ? 64 : 48, 48),
    p = palettes[team];
  if (id.startsWith('body_')) {
    const d = bodySizes[id],
      radius = d / 2;
    r.ellipse(24, 24, radius, radius, ink);
    r.ellipse(24, 24, radius - 1, radius - 1, p.dark);
    r.ellipse(24, 22, radius - 3, radius - 3, p.main);
    // Cream bumper arcs, kept strictly inside the circular collision silhouette.
    for (const y of [24 - radius + 4, 24 + radius - 7]) {
      r.rect(19, y, 10, 2, cream);
      r.rect(17, y + 1, 2, 2, p.hi);
    }
    r.rect(24 - radius + 3, 21, 2, 6, metal);
    r.rect(24 - radius + 3, 22, 1, 4, gold);
    r.rect(27, 17, 2, 4, p.hi);
    r.rect(27, 27, 2, 4, p.dark);
    if (d >= 38)
      for (const y of [15, 31]) {
        r.box(13, y, 4, 3, metal);
        r.pixel(14, y + 1, gold);
      }
    if (d === 46)
      for (const y of [9, 37]) {
        r.box(20, y, 8, 3, metal);
        r.rect(22, y + 1, 4, 1, lightMetal);
      }
  } else if (id === 'legs_hover') {
    r.box(17, 8, 12, 32, metal);
    for (const y of [2, 35]) {
      r.ellipse(14, y + 5.5, 12, 5.5, ink);
      r.ellipse(14, y + 5.5, 10, 4.5, p.dark);
      r.rect(8, y + 2, 12, 4, p.main);
      r.rect(8, y + 1, 10, 1, p.hi);
      r.rect(9, y + 7, 9, 2, gold);
      r.rect(4, y + 4, 3, 2, cream);
    }
  } else if (id === 'legs_biped') {
    r.box(18, 5, 8, 38, metal);
    for (const y of [2, 36]) {
      r.box(25, y + 2, 12, 6, lightMetal);
      r.box(34, y, 13, 10, p.dark);
      r.rect(36, y + 1, 8, 5, p.main);
      r.rect(43, y + 2, 3, 5, cream);
      r.rect(36, y + 1, 6, 1, p.hi);
      r.rect(33, y + 3, 2, 2, gold);
    }
  } else if (id === 'legs_tank') {
    r.box(9, 7, 27, 34, metal);
    for (const y of [0, 37]) {
      r.box(5, y, 36, 11, metal);
      for (let x = 8; x < 39; x += 5) {
        r.rect(x, y + 1, 3, 9, ink);
        r.rect(x, y + 2, 3, 2, lightMetal);
      }
      r.rect(12, y + 4, 21, 3, p.main);
      r.rect(12, y + 4, 21, 1, p.hi);
      r.pixel(8, y + 5, gold);
      r.pixel(37, y + 5, gold);
    }
  } else if (id.startsWith('weapon_')) {
    // Center (24,24) is preserved; all receivers start beyond the 12px core.
    r.ellipse(36, 24, 5, 6, ink);
    r.ellipse(36, 24, 3, 4, p.dark);
    if (id === 'weapon_machinegun') {
      r.box(32, 19, 11, 10, p.main);
      r.rect(34, 20, 6, 1, p.hi);
      for (const y of [20, 25]) {
        r.box(41, y, 18, 3, metal);
        r.rect(44, y, 2, 3, gold);
        r.rect(48, y + 1, 8, 1, lightMetal);
        r.rect(57, y + 1, 2, 1, ink);
      }
      r.box(34, 29, 6, 4, metal);
    } else if (id === 'weapon_shotgun') {
      r.box(32, 17, 13, 14, p.main);
      r.rect(34, 18, 8, 2, p.hi);
      r.box(43, 18, 12, 12, metal);
      r.rect(46, 19, 2, 10, goldDark);
      r.rect(49, 19, 2, 10, lightMetal);
      r.rect(53, 20, 2, 8, ink);
      r.rect(34, 28, 6, 2, gold);
    } else {
      r.box(32, 18, 12, 12, p.main);
      r.rect(34, 19, 7, 2, p.hi);
      r.box(42, 19, 14, 10, metal);
      r.rect(44, 20, 10, 2, lightMetal);
      r.box(54, 17, 5, 14, lightMetal);
      r.rect(54, 18, 2, 12, gold);
      r.rect(57, 19, 2, 10, ink);
    }
  } else {
    // Distinct 12x12 silhouettes at the actual body center, with no shared round badge.
    if (id === 'core_vital') {
      r.poly(
        [
          [18, 18],
          [30, 18],
          [30, 25],
          [28, 28],
          [24, 30],
          [20, 28],
          [18, 25],
        ],
        ink,
      );
      r.poly(
        [
          [20, 20],
          [28, 20],
          [28, 25],
          [26, 27],
          [24, 28],
          [22, 27],
          [20, 25],
        ],
        cream,
      );
      r.poly(
        [
          [24, 21],
          [27, 21],
          [27, 25],
          [24, 27],
        ],
        gold,
      );
    }
    if (id === 'core_boost') {
      for (const x of [18, 24]) {
        r.poly(
          [
            [x, 18],
            [x + 6, 24],
            [x, 30],
            [x, 26],
            [x + 2, 24],
            [x, 22],
          ],
          ink,
        );
        r.poly(
          [
            [x + 1, 20],
            [x + 5, 24],
            [x + 1, 28],
            [x + 1, 26],
            [x + 3, 24],
            [x + 1, 22],
          ],
          gold,
        );
      }
    }
    if (id === 'core_power') {
      r.poly(
        [
          [24, 18],
          [27, 22],
          [28, 20],
          [30, 25],
          [29, 28],
          [26, 30],
          [21, 30],
          [18, 27],
          [18, 24],
          [21, 20],
          [21, 24],
        ],
        ink,
      );
      r.poly(
        [
          [24, 20],
          [26, 24],
          [28, 23],
          [28, 27],
          [26, 29],
          [22, 29],
          [20, 26],
          [21, 24],
          [22, 26],
        ],
        gold,
      );
      r.poly(
        [
          [24, 24],
          [26, 27],
          [25, 29],
          [23, 29],
          [22, 27],
        ],
        cream,
      );
    }
  }
  return r;
}
for (const id of ids) for (const team of ['blue', 'red']) save(`td_${id}_${team}`, top(id, team));

// Frontal, detached modules drawn on a 48px logical grid then enlarged exactly 2x.
function front(id) {
  const r = new Raster(48),
    p = palettes.blue;
  if (id.startsWith('body_')) {
    const d = { body_light: 28, body_standard: 34, body_heavy: 40 }[id];
    r.ellipse(24, 25, d / 2, d / 2, ink);
    r.ellipse(24, 24, d / 2 - 2, d / 2 - 2, p.dark);
    r.ellipse(24, 21, d / 2 - 3, d / 2 - 4, p.main);
    r.box(17, 8, 14, 7, cream);
    r.box(19, 10, 10, 3, metal);
    r.rect(20, 11, 8, 1, gold);
    for (const x of [24 - d / 2 + 2, 24 + d / 2 - 5]) {
      r.box(x, 22, 4, 10, cream);
      r.pixel(x + 1, 24, gold);
    }
    r.ellipse(24, 26, 7, 7, ink);
    r.ellipse(24, 26, 5, 5, goldDark);
    r.ellipse(24, 25, 4, 4, gold);
    r.box(19, 35, 10, 6, metal);
    r.rect(21, 37, 6, 1, lightMetal);
    r.rect(21, 39, 6, 1, lightMetal);
    r.rect(14, 17, 6, 2, p.hi);
  } else if (id === 'legs_biped') {
    r.box(12, 7, 24, 9, metal);
    r.poly(
      [
        [14, 9],
        [34, 9],
        [29, 21],
        [19, 21],
      ],
      p.main,
    );
    for (const x of [10, 28]) {
      r.box(x + 2, 17, 6, 17, metal);
      r.ellipse(x + 5, 27, 5, 5, ink);
      r.ellipse(x + 5, 27, 3, 3, gold);
      r.box(x, 32, 12, 10, p.dark);
      r.rect(x + 1, 33, 7, 4, p.main);
      r.rect(x + 8, 33, 3, 6, cream);
      r.rect(x, 41, 12, 2, ink);
    }
  } else if (id === 'legs_hover') {
    r.box(12, 16, 24, 9, p.dark);
    r.rect(16, 17, 16, 2, p.main);
    for (const x of [4, 28]) {
      r.ellipse(x + 8, 28, 8, 10, ink);
      r.ellipse(x + 8, 26, 6, 7, p.main);
      r.rect(x + 3, 25, 10, 3, cream);
      r.box(x + 2, 32, 12, 6, metal);
      r.rect(x + 4, 34, 8, 2, gold);
    }
  } else if (id === 'legs_tank') {
    r.box(12, 16, 24, 20, p.dark);
    r.rect(14, 17, 20, 4, p.main);
    r.rect(18, 25, 12, 3, gold);
    for (const x of [3, 33]) {
      r.box(x, 10, 12, 32, metal);
      for (let y = 12; y < 40; y += 5) {
        r.rect(x + 1, y, 10, 2, lightMetal);
        r.rect(x + 2, y + 2, 8, 2, ink);
      }
      r.rect(x + 4, 17, 4, 17, p.main);
      r.rect(x + 4, 17, 1, 17, p.hi);
    }
  } else if (id.startsWith('weapon_')) {
    r.box(20, 29, 8, 13, metal);
    r.box(12, 19, 24, 15, p.dark);
    r.rect(15, 21, 18, 5, p.main);
    const barrels = id === 'weapon_shotgun' ? [12, 26] : [19];
    for (const x of barrels) {
      const w = id === 'weapon_cannon' ? 14 : 10,
        bx = id === 'weapon_cannon' ? 17 : x;
      r.box(bx, 7, w, 19, metal);
      r.rect(bx + 1, 10, w - 2, 3, gold);
      r.box(bx - 1, 6, w + 2, 9, lightMetal);
      r.ellipse(bx + w / 2, 10.5, w / 2 - 1, 3.5, ink);
      r.rect(bx + 2, 17, 2, 6, lightMetal);
    }
    r.rect(15, 28, 5, 2, gold);
    r.rect(29, 28, 4, 2, cream);
  } else {
    r.box(12, 10, 24, 29, metal);
    r.box(14, 12, 20, 24, p.dark);
    for (const x of [9, 36]) for (const y of [15, 23, 31]) r.rect(x, y, 3, 3, gold);
    r.ellipse(24, 24, 11, 11, ink);
    r.ellipse(24, 23, 9, 9, goldDark);
    r.ellipse(24, 22, 7, 7, gold);
    if (id === 'core_vital') {
      r.rect(22, 17, 4, 12, cream);
      r.rect(18, 21, 12, 4, cream);
    }
    if (id === 'core_boost')
      r.poly(
        [
          [24, 15],
          [18, 23],
          [23, 23],
          [21, 30],
          [30, 20],
          [24, 20],
        ],
        cream,
      );
    if (id === 'core_power') {
      r.box(20, 19, 8, 8, cream);
      r.rect(22, 21, 4, 4, gold);
    }
  }
  const scaled = new Raster(96);
  scaled.blit(r, 0, 0, 2);
  return scaled;
}
for (const id of ids) save(`part_${id}`, front(id));
for (const weapon of ids.filter((id) => id.startsWith('weapon_'))) {
  const r = new Raster(12);
  if (weapon === 'weapon_machinegun') {
    r.box(2, 4, 9, 4, gold);
    r.rect(3, 5, 6, 1, cream);
  }
  if (weapon === 'weapon_shotgun') {
    r.ellipse(6, 6, 4, 4, ink);
    r.ellipse(6, 6, 3, 3, gold);
    r.rect(5, 4, 2, 2, cream);
  }
  if (weapon === 'weapon_cannon') {
    r.ellipse(6, 6, 6, 6, ink);
    r.ellipse(6, 6, 4, 4, goldDark);
    r.ellipse(6, 5, 3, 3, gold);
    r.rect(5, 3, 2, 2, cream);
  }
  save(`bullet_${weapon}`, r);
}
const dummy = new Raster(48);
dummy.blit(top('legs_tank', 'red'), 0, 0);
dummy.blit(top('body_standard', 'red'), 0, 0);
for (const [radius, c] of [
  [12, ink],
  [10, cream],
  [7, palettes.red.main],
  [4, cream],
  [2, palettes.red.dark],
])
  dummy.ellipse(24, 24, radius, radius, c);
save('dummy', dummy);

function capsule(open) {
  const r = new Raster(64);
  const cy = open ? 40 : 34,
    bottomRadius = open ? 21 : 24;
  // Opaque golden lower bowl. A single thin seam replaces bands and buttons.
  for (let y = cy; y < cy + bottomRadius; y++)
    for (let x = 8; x < 56; x++) {
      const distance = ((x + 0.5 - 32) / 24) ** 2 + ((y + 0.5 - cy) / bottomRadius) ** 2;
      if (distance <= 1) {
        const inner = ((x + 0.5 - 32) / 22) ** 2 + ((y + 0.5 - cy) / (bottomRadius - 2)) ** 2;
        r.pixel(x, y, inner > 1 ? goldDark : y > cy + bottomRadius - 6 ? '#E8AE45' : gold);
      }
    }
  if (open) {
    r.ellipse(32, cy, 24, 4, goldDark);
    r.ellipse(32, cy - 1, 22, 2, '#F6DF9B');
  }
  // A neutral toy component is faintly visible behind the closed clear shell.
  if (!open) {
    r.rect(26, 23, 12, 7, '#8B978B', 130);
    r.rect(29, 20, 6, 3, '#8B978B', 130);
    r.rect(29, 25, 6, 2, '#FFF3DC', 170);
  }
  const dome = new Raster(64),
    seam = open ? 25 : 34,
    height = open ? 22 : 24;
  for (let y = seam - height; y < seam; y++)
    for (let x = 8; x < 56; x++) {
      const distance = ((x + 0.5 - 32) / 24) ** 2 + ((y + 0.5 - seam) / height) ** 2;
      if (distance <= 1) {
        const inner = ((x + 0.5 - 32) / 23) ** 2 + ((y + 0.5 - seam) / (height - 1)) ** 2;
        dome.pixel(x, y, inner > 1 ? '#82978A' : '#DDECDD', inner > 1 ? 210 : 110);
      }
    }
  dome.rect(17, seam - 15, 2, 7, '#FFF3DC', 220);
  dome.rect(19, seam - 18, 6, 2, '#FFF3DC', 220);
  dome.rect(8, seam - 1, 48, 1, '#82978A', 210);
  r.blit(dome, 0, 0);
  const scaled = new Raster(128);
  scaled.blit(r, 0, 0, 2);
  return scaled;
}
save('capsule_closed', capsule(false));
save('capsule_open', capsule(true));
for (const [kind, id] of Object.entries({
  body: 'body_standard',
  legs: 'legs_biped',
  weapon: 'weapon_cannon',
  core: 'core_power',
})) {
  const source = front(id),
    r = new Raster(32);
  // Exact nearest-neighbour from the underlying 48px frontal drawing.
  for (let y = 0; y < 32; y++)
    for (let x = 0; x < 32; x++) {
      const sx = Math.floor((x * 3) / 2) * 2,
        sy = Math.floor((y * 3) / 2) * 2,
        i = (sy * 96 + sx) * 4;
      if (source.data[i + 3]) r.pixel(x, y, `#${source.data.subarray(i, i + 3).toString('hex')}`);
    }
  save(`icon_${kind}`, r);
}
for (const wall of [false, true]) {
  const r = new Raster(32);
  r.rect(0, 0, 32, 32, wall ? metal : '#293B50');
  // Periodic panel seams: edge rows/columns match exactly on both sides.
  for (let i = 0; i < 32; i++) {
    for (const edge of [0, 31]) {
      r.pixel(i, edge, wall ? '#293B50' : '#243447');
      r.pixel(edge, i, wall ? '#293B50' : '#243447');
    }
  }
  if (wall) {
    r.rect(2, 2, 28, 1, lightMetal);
    r.rect(2, 3, 1, 26, lightMetal);
    r.rect(3, 29, 26, 1, ink);
    r.rect(29, 3, 1, 26, ink);
    for (const x of [5, 24])
      for (const y of [5, 24]) {
        r.box(x, y, 3, 3, ink);
        r.pixel(x + 1, y + 1, lightMetal);
      }
    for (let y = 12; y < 22; y += 3) {
      r.rect(11, y, 11, 2, ink);
      r.rect(12, y, 9, 1, '#293B50');
    }
  } else {
    r.pixel(8, 8, '#304258');
    r.pixel(24, 24, '#304258');
    r.pixel(24, 8, '#26374B');
    r.pixel(8, 24, '#26374B');
  }
  save(wall ? 'tile_wall' : 'tile_floor', r);
}
// Winner seal: trophy and laurel, intentionally language-independent.
const stamp = new Raster(64);
stamp.ellipse(32, 32, 30, 30, ink);
stamp.ellipse(32, 32, 28, 28, goldDark);
stamp.ellipse(32, 31, 26, 26, gold);
stamp.ellipse(32, 31, 22, 22, ink);
for (const x of [14, 46])
  for (let y = 24; y < 46; y += 6)
    stamp.poly(
      [
        [x, y],
        [x - 3, y - 5],
        [x - 5, y - 3],
        [x - 2, y + 2],
      ],
      gold,
    );
stamp.box(19, 18, 26, 13, goldDark);
stamp.rect(21, 20, 22, 7, ink);
stamp.poly(
  [
    [23, 15],
    [41, 15],
    [39, 31],
    [35, 35],
    [29, 35],
    [25, 31],
  ],
  gold,
);
stamp.rect(26, 17, 3, 11, cream);
stamp.rect(30, 34, 4, 8, gold);
stamp.box(24, 42, 16, 5, goldDark);
stamp.rect(26, 42, 12, 3, gold);
stamp.poly(
  [
    [32, 19],
    [34, 23],
    [38, 23],
    [35, 26],
    [36, 30],
    [32, 28],
    [28, 30],
    [29, 26],
    [26, 23],
    [30, 23],
  ],
  cream,
);
const stampLarge = new Raster(128);
stampLarge.blit(stamp, 0, 0, 2);
save('stamp_win', stampLarge);

execFileSync('rsvg-convert', [
  '--width',
  '640',
  '--height',
  '200',
  '--output',
  path.join(out, 'logo.png'),
  path.join(root, 'scripts/assets/source/logo.svg'),
]);
images.logo = 'img/logo.png';
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify({ images }, null, 2) + '\n');

// 81 loadouts per team: every legal combination shown at exactly 4x.
const groups = {
  body: ids.filter((x) => x.startsWith('body_')),
  legs: ids.filter((x) => x.startsWith('legs_')),
  weapon: ids.filter((x) => x.startsWith('weapon_')),
  core: ids.filter((x) => x.startsWith('core_')),
};
const preview = new Raster(9 * 272, 18 * 208);
preview.rect(0, 0, preview.w, preview.h, ink);
for (const [ti, team] of ['blue', 'red'].entries()) {
  let i = 0;
  for (const body of groups.body)
    for (const legs of groups.legs)
      for (const core of groups.core)
        for (const weapon of groups.weapon) {
          const x = (i % 9) * 272,
            y = (Math.floor(i / 9) + ti * 9) * 208;
          preview.rect(x + 2, y + 2, 268, 204, '#293B50');
          for (const part of [legs, body, core, weapon])
            preview.blit(rasters.get(`td_${part}_${team}`), x + 8, y + 8, 4);
          i++;
        }
}
preview.save(path.join(root, 'docs/screens/assets-preview.png'));
// Full inventory sheet, each asset shown in nearest-neighbour pixels, logo at native size.
const sheet = new Raster(1152, 1120);
sheet.rect(0, 0, 1152, 1120, ink);
let i = 0;
for (const r of rasters.values()) {
  const x = (i % 8) * 144,
    y = Math.floor(i / 8) * 160;
  sheet.rect(x + 2, y + 2, 140, 156, '#293B50');
  const scale = r.w <= 64 ? 2 : 1;
  sheet.blit(r, x + Math.floor((144 - r.w * scale) / 2), y + 10, scale);
  i++;
}
sheet.save(path.join(root, 'docs/screens/assets-catalog.png'));
console.log(`Generated ${Object.keys(images).length} PNG assets and 162 assembled previews.`);
