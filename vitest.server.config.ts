import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-plugin';

export default defineConfig({
  plugins: [cloudflareTest({ wrangler: { configPath: './wrangler.jsonc' } })],
  test: {
    name: 'server',
    include: ['tests/server/**/*.test.ts'],
  },
});
