import { chromium, devices, expect, webkit, type Browser, type Page } from '@playwright/test';

export type Engine = 'chromium' | 'webkit';
export const BASE = process.env.E2E_BASE ?? 'https://localhost:5173';

export interface PlayerOptions {
  /** Émulation téléphone : iPhone pour WebKit, Pixel pour Chromium. */
  mobile?: boolean;
  /** Force la signalisation par polling HTTP (test du repli). */
  forcePoll?: boolean;
  /** false : la caméra est refusée. */
  camera?: boolean;
}

export interface Player {
  browser: Browser;
  page: Page;
  engine: Engine;
  close: () => Promise<void>;
}

export async function openPlayer(engine: Engine, opts: PlayerOptions = {}): Promise<Player> {
  const camera = opts.camera !== false;
  const browser =
    engine === 'chromium'
      ? await chromium.launch({
          args: ['--use-fake-device-for-media-stream', ...(camera ? ['--use-fake-ui-for-media-stream'] : [])],
        })
      : await webkit.launch();
  const device = opts.mobile ? devices[engine === 'webkit' ? 'iPhone 14' : 'Pixel 7'] : {};
  const context = await browser.newContext({
    ...device,
    ignoreHTTPSErrors: true,
    permissions: camera ? ['camera', 'microphone'] : [],
  });
  await context.addInitScript((forcePoll) => {
    const w = window as unknown as Record<string, unknown>;
    w.__AURA_E2E__ = true;
    w.__AURA_FORCE_POLL__ = forcePoll;
  }, opts.forcePoll === true);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`[${engine} pageerror]`, e.message));
  return { browser, page, engine, close: () => browser.close() };
}

/** Modifie le visage simulé lu par le faux suivi facial. */
export async function setFace(page: Page, f: Partial<{ face: boolean; smile: number; jaw: number; noseDx: number }>) {
  await page.evaluate((patch) => {
    const w = window as unknown as { __auraFace?: Record<string, unknown> };
    w.__auraFace = { face: true, smile: 0.05, jaw: 0.05, noseDx: 0, ...w.__auraFace, ...patch };
  }, f);
}

export const NEUTRAL = { smile: 0.05, jaw: 0.05, noseDx: 0, face: true };
export const LAUGH = { smile: 0.9, jaw: 0.9 };

export interface AudioEntry {
  id: string;
  state: string;
  at: number;
  loaded: boolean;
}

export const audioLog = (page: Page): Promise<AudioEntry[]> =>
  page.evaluate(() => (window as unknown as { __auraAudioLog?: AudioEntry[] }).__auraAudioLog ?? []);

export const audioStatus = (page: Page) =>
  page.evaluate(() => {
    const f = (window as unknown as { __auraAudioStatus?: () => { state: string; loaded: number; total: number; error: string | null } }).__auraAudioStatus;
    return f ? f() : null;
  });

/** Attend que tous les sons soient décodés et l'AudioContext actif. */
export async function expectAudioReady(page: Page) {
  await expect.poll(() => audioStatus(page), { timeout: 20_000 }).toMatchObject({ state: 'running', loaded: 20, error: null });
}

/** Attend qu'un son soit réellement programmé (tampon chargé, contexte actif). */
export async function expectSoundPlayed(page: Page, since: number, id?: string) {
  await expect
    .poll(async () => (await audioLog(page)).slice(since).filter((e) => e.loaded && e.state === 'running' && (!id || e.id === id)).length, {
      timeout: 5000,
    })
    .toBeGreaterThan(0);
}

/** Crée un duel (hôte) ou le rejoint (invité), active la caméra et attend la fin de la calibration. */
export async function enterLobby(player: Player, code?: string): Promise<string> {
  const { page } = player;
  await page.goto('/');
  if (code) {
    await page.getByLabel('Code du duel').fill(code);
    await page.getByRole('button', { name: 'Rejoindre' }).click();
  } else {
    await page.getByRole('button', { name: 'Créer un duel' }).click();
  }
  await page.waitForURL(/\/r\/[A-Z0-9]{6}/);
  const roomCode = page.url().match(/\/r\/([A-Z0-9]{6})/)?.[1] ?? '';
  await page.getByRole('button', { name: /Activer la caméra/ }).click();
  await expect(page.getByRole('button', { name: /Partager le lien|Lien copié/ })).toBeVisible({ timeout: 30_000 });
  return roomCode;
}

/** Duel complet jusqu'au début de la manche 1 sur les deux téléphones. */
export async function startDuel(host: Player, guest: Player) {
  const code = await enterLobby(host);
  await enterLobby(guest, code);
  for (const p of [host, guest]) await expect(p.page.getByText('Adversaire connecté')).toBeVisible({ timeout: 20_000 });
  await host.page.getByRole('button', { name: 'Prêt', exact: true }).click();
  await guest.page.getByRole('button', { name: 'Prêt', exact: true }).click();
  for (const p of [host, guest]) await expect(p.page.getByText(/Manche 1 ·/)).toBeVisible({ timeout: 15_000 });
  return code;
}

/** Vrai si la vidéo de l'adversaire reçoit des images. */
export const remoteVideoPlaying = (page: Page) =>
  page.evaluate(() => {
    const v = document.querySelector('video');
    return !!v && v.readyState >= 2 && v.videoWidth > 0;
  });

/** Attend la phase de jeu (les boutons de son deviennent actifs). */
export async function waitForPlay(page: Page) {
  await expect(page.getByRole('button', { name: /^Son / }).first()).toBeEnabled({ timeout: 15_000 });
}
