import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const palettes = {
  blue: { main: '#4C8DFF', dark: '#2956A8', hi: '#A8D3FF' },
  red: { main: '#FF5C5C', dark: '#AA354B', hi: '#FFB4A3' },
};

// Reuse the td_ palette, replacing exact RGB values without changing alpha or geometry.
export function generateRedParts(out, ids, images) {
  assert.equal(ids.length, 12);
  assert.equal(new Set(ids).size, 12);
  for (const id of ids) {
    const key = `part_${id}`;
    assert.equal(images[key], `img/${key}.png`);
    const replacements = Object.entries(palettes.blue).flatMap(([shade, color]) => [
      '-fill',
      palettes.red[shade],
      '-opaque',
      color,
    ]);
    execFileSync(
      'magick',
      [
        path.join(out, `${key}.png`),
        '-channel',
        'RGB',
        '-fuzz',
        '0',
        ...replacements,
        '+channel',
        '-strip',
        '-define',
        'png:color-type=6',
        path.join(out, `${key}_red.png`),
      ],
      { timeout: 15000, env: { ...process.env, MAGICK_THREAD_LIMIT: '1' } },
    );
    images[`${key}_red`] = `img/${key}_red.png`;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const out = path.join(root, 'public/img');
  const manifestPath = path.join(out, 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const ids = [
    ...readFileSync(path.join(root, 'shared/parts.ts'), 'utf8').matchAll(/id: '(\w+)'/g),
  ].map((match) => match[1]);
  generateRedParts(out, ids, manifest.images);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`Generated ${ids.length} red frontal parts and updated manifest.`);
}
