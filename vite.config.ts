import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { apiDevPlugin } from './scripts/vite-api-plugin.ts';

// `npm run dev:phone` : HTTPS auto-signé + écoute sur le réseau local, pour tester la caméra sur téléphone.
const phone = process.env.DEV_PHONE === '1';

export default defineConfig({
  plugins: [react(), apiDevPlugin(), ...(phone ? [basicSsl()] : [])],
  server: { host: phone, port: 5173, strictPort: true },
  test: { include: ['src/**/*.test.ts', 'api/**/*.test.ts'] },
});
