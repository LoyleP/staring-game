import { expect, test } from '@playwright/test';

test.describe('API et fichiers statiques', () => {
  test('salon : création, jonction, 3e joueur refusé, code inconnu, jetons', async ({ request }) => {
    const post = (data: object) => request.post('/api/rooms', { data });
    const host = await (await post({ action: 'create' })).json();
    expect(host).toMatchObject({ role: 'host', peerPresent: false });
    expect(host.code).toMatch(/^[A-Z2-9]{6}$/);

    const guest = await (await post({ action: 'join', code: host.code })).json();
    expect(guest).toMatchObject({ role: 'guest', peerPresent: true });

    expect((await post({ action: 'join', code: host.code })).status()).toBe(409);
    expect((await post({ action: 'join', code: 'ZZZZZZ' })).status()).toBe(404);
    expect((await post({ action: 'join', code: 'bad' })).status()).toBe(400);
    expect((await post({ action: 'resume', code: host.code, token: 'nope' })).status()).toBe(403);
    expect(await (await post({ action: 'resume', code: host.code, token: guest.token })).json()).toMatchObject({ role: 'guest' });
    expect((await post({ action: 'status', code: host.code, token: guest.token, status: 'playing' })).status()).toBe(403);
    expect((await post({ action: 'status', code: host.code, token: host.token, status: 'playing' })).status()).toBe(200);
  });

  test('signalisation par polling : relais filtré entre les deux joueurs', async ({ request }) => {
    const post = (url: string, data: object) => request.post(url, { data });
    const host = await (await post('/api/rooms', { action: 'create' })).json();
    const guest = await (await post('/api/rooms', { action: 'join', code: host.code })).json();
    const poll = async (token: string, send: object[] = []) =>
      (await (await post('/api/signal-poll', { code: host.code, token, send })).json()).messages;
    expect(await poll(host.token)).toEqual([{ type: 'peer-joined' }]);
    await poll(guest.token, [{ type: 'offer', sdp: 'x' }, { type: 'peer-left' }]);
    expect(await poll(host.token)).toEqual([{ type: 'offer', sdp: 'x' }]);
    expect((await post('/api/signal-poll', { code: host.code, token: 'bad' })).status()).toBe(403);
  });

  test('identifiants ICE : toujours au moins un serveur STUN', async ({ request }) => {
    const body = await (await request.get('/api/turn-credentials')).json();
    expect(body.iceServers.some((s: { urls: string[] }) => s.urls.some((u) => u.startsWith('stun:')))).toBe(true);
  });

  test('les 20 sons et le modèle MediaPipe sont servis', async ({ request }) => {
    for (let i = 1; i <= 20; i++) {
      const res = await request.get(`/sounds/s${String(i).padStart(2, '0')}.mp3`);
      expect(res.status(), `son ${i}`).toBe(200);
      expect(res.headers()['content-type']).toContain('audio/mpeg');
    }
    expect((await request.get('/mediapipe/face_landmarker.task')).status()).toBe(200);
    expect((await request.get('/mediapipe/wasm/vision_wasm_internal.wasm')).status()).toBe(200);
  });

  test('les routes de l’application se rechargent sans 404', async ({ request }) => {
    for (const path of ['/', '/solo', '/r/ABC234']) expect((await request.get(path)).status(), path).toBe(200);
  });
});
