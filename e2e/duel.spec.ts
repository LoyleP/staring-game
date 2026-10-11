import { expect, test } from '@playwright/test';
import {
  audioLog,
  expectAudioReady,
  expectSoundPlayed,
  LAUGH,
  NEUTRAL,
  openPlayer,
  remoteVideoPlaying,
  setFace,
  startDuel,
  waitForPlay,
  type Engine,
  type PlayerOptions,
} from './helpers';

interface Pairing {
  label: string;
  host: [Engine, PlayerOptions?];
  guest: [Engine, PlayerOptions?];
}

const pairings: Pairing[] = [
  { label: 'Chrome ↔ Chrome', host: ['chromium'], guest: ['chromium'] },
  { label: 'Chrome (hôte) ↔ Safari', host: ['chromium'], guest: ['webkit'] },
  { label: 'Safari (hôte) ↔ Chrome', host: ['webkit'], guest: ['chromium'] },
  { label: 'Safari ↔ Safari', host: ['webkit'], guest: ['webkit'] },
  { label: 'iPhone (hôte) ↔ Android', host: ['webkit', { mobile: true }], guest: ['chromium', { mobile: true }] },
  {
    label: 'Repli polling : Android (hôte) ↔ iPhone',
    host: ['chromium', { mobile: true, forcePoll: true }],
    guest: ['webkit', { mobile: true, forcePoll: true }],
  },
];

for (const pair of pairings) {
  test(`Duel complet · ${pair.label}`, async () => {
    const host = await openPlayer(pair.host[0], pair.host[1]);
    const guest = await openPlayer(pair.guest[0], pair.guest[1]);
    try {
      await startDuel(host, guest);

      // Vidéo dans les deux sens
      for (const p of [host, guest]) await expect.poll(() => remoteVideoPlaying(p.page), { timeout: 15_000 }).toBe(true);

      // Sons prêts des deux côtés
      for (const p of [host, guest]) await expectAudioReady(p.page);
      await waitForPlay(guest.page);

      // Son lancé par l'invité : joué sur les deux téléphones, même identifiant
      const hostBefore = (await audioLog(host.page)).length;
      const guestBefore = (await audioLog(guest.page)).length;
      await guest.page.getByRole('button', { name: /^Son / }).first().click();
      await expectSoundPlayed(guest.page, guestBefore);
      const id = (await audioLog(guest.page)).slice(guestBefore).find((e) => e.loaded)?.id;
      await expectSoundPlayed(host.page, hostBefore, id);

      // Son aléatoire du jeu : décidé par l'hôte, joué sur les deux
      const h2 = (await audioLog(host.page)).length;
      const g2 = (await audioLog(guest.page)).length;
      await expect.poll(async () => (await audioLog(host.page)).length, { timeout: 25_000 }).toBeGreaterThan(h2);
      const randomId = (await audioLog(host.page)).slice(h2)[0]?.id;
      await expectSoundPlayed(guest.page, g2, randomId);

      // Manche 1 : l'invité craque
      await setFace(guest.page, LAUGH);
      await expect(host.page.getByRole('heading', { name: 'Manche gagnée' })).toBeVisible();
      await expect(guest.page.getByRole('heading', { name: 'Manche perdue' })).toBeVisible();
      await setFace(guest.page, NEUTRAL);

      // Manche 2 : l'invité craque encore → fin de partie
      for (const p of [host, guest]) await expect(p.page.getByText(/Manche 2 ·/)).toBeVisible({ timeout: 15_000 });
      await waitForPlay(guest.page);
      await setFace(guest.page, LAUGH);
      await expect(host.page.getByRole('heading', { name: 'Tu gagnes la partie' })).toBeVisible();
      await expect(guest.page.getByRole('heading', { name: 'Tu perds la partie' })).toBeVisible();
      await setFace(guest.page, NEUTRAL);

      // Revanche demandée par les deux
      await host.page.getByRole('button', { name: /^Revanche/ }).click();
      await guest.page.getByRole('button', { name: /^Revanche/ }).click();
      for (const p of [host, guest]) await expect(p.page.getByText(/Manche 1 · 0-0/)).toBeVisible({ timeout: 15_000 });
    } finally {
      await host.close();
      await guest.close();
    }
  });
}
