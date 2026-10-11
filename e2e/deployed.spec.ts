import { expect, test } from '@playwright/test';
import WebSocket from 'ws';
import { chromium, webkit } from '@playwright/test';

/**
 * Vérification d'un déploiement Vercel (production ou preview), sans les accroches de test :
 *   E2E_DEPLOYED=https://staring-game.vercel.app npx playwright test e2e/deployed.spec.ts
 */
const URL = process.env.E2E_DEPLOYED;
test.skip(!URL, 'E2E_DEPLOYED non défini');
test.use({ baseURL: URL });

test('fichiers : 20 sons, modèle et WASM MediaPipe', async ({ request }) => {
  for (let i = 1; i <= 20; i++) {
    const res = await request.get(`/sounds/s${String(i).padStart(2, '0')}.mp3`);
    expect(res.status(), `son ${i}`).toBe(200);
    expect(res.headers()['content-type']).toContain('audio/mpeg');
  }
  expect((await request.get('/mediapipe/face_landmarker.task')).status()).toBe(200);
  const wasm = await request.get('/mediapipe/wasm/vision_wasm_internal.wasm');
  expect(wasm.status()).toBe(200);
  expect(wasm.headers()['content-type']).toContain('application/wasm');
});

test('API : Redis, salon, signalisation WebSocket', async ({ request }) => {
  expect(await (await request.get('/api/health')).json()).toMatchObject({ store: 'redis', ok: true });
  const host = await (await request.post('/api/rooms', { data: { action: 'create' } })).json();
  const guest = await (await request.post('/api/rooms', { data: { action: 'join', code: host.code } })).json();
  const wsUrl = `${URL?.replace('https', 'wss')}/api/signal?code=${host.code}`;
  const open = (token: string) =>
    new Promise<{ ws: WebSocket; got: unknown[] }>((resolve, reject) => {
      const ws = new WebSocket(`${wsUrl}&token=${token}`);
      const got: unknown[] = [];
      ws.on('message', (d) => got.push(JSON.parse(String(d))));
      ws.on('open', () => resolve({ ws, got }));
      ws.on('error', reject);
    });
  const h = await open(host.token);
  const g = await open(guest.token);
  g.ws.send(JSON.stringify({ type: 'offer', sdp: 'x' })); // envoyé dès l'ouverture : ne doit pas se perdre
  await expect.poll(() => h.got).toContainEqual({ type: 'offer', sdp: 'x' });
  h.ws.close();
  g.ws.close();
});

for (const [name, engine] of [['Chrome', chromium], ['Safari', webkit]] as const) {
  test(`${name} : accueil, création de duel, décodage des sons déployés`, async () => {
    const browser = await engine.launch();
    try {
      const page = await (await browser.newContext()).newPage();
      await page.goto(`${URL}/`);
      await page.getByRole('button', { name: 'Créer un duel' }).click();
      await page.waitForURL(/\/r\/[A-Z0-9]{6}/);
      await expect(page.getByRole('button', { name: /Activer la caméra/ })).toBeVisible();
      const decoded = await page.evaluate(async () => {
        const ctx = new AudioContext();
        let ok = 0;
        for (let i = 1; i <= 20; i++) {
          const res = await fetch(`/sounds/s${String(i).padStart(2, '0')}.mp3`);
          if (res.ok && (await ctx.decodeAudioData(await res.arrayBuffer())).duration > 0) ok++;
        }
        return ok;
      });
      expect(decoded).toBe(20);
    } finally {
      await browser.close();
    }
  });
}
