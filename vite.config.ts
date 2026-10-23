import { defineConfig } from 'vite';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // LAN 上のスマホから接続して検証するため
    host: true,
  },
});
