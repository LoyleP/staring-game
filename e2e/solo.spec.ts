import { expect, test } from '@playwright/test';
import { audioLog, expectAudioReady, expectSoundPlayed, LAUGH, openPlayer, setFace, waitForPlay, type Engine } from './helpers';

const variants: { engine: Engine; mobile: boolean; label: string }[] = [
  { engine: 'chromium', mobile: false, label: 'Chrome bureau' },
  { engine: 'chromium', mobile: true, label: 'Chrome Android (Pixel 7)' },
  { engine: 'webkit', mobile: false, label: 'Safari bureau' },
  { engine: 'webkit', mobile: true, label: 'Safari iPhone 14' },
];

for (const v of variants) {
  test.describe(`Solo · ${v.label}`, () => {
    test('calibration, sons (bouton et aléatoire), pénalité, craquage', async () => {
      const p = await openPlayer(v.engine, { mobile: v.mobile });
      try {
        const { page } = p;
        await page.goto('/solo');
        await page.getByRole('button', { name: 'Activer la caméra' }).click();
        await expect(page.getByRole('button', { name: 'Lancer la manche' })).toBeVisible({ timeout: 30_000 });
        await expectAudioReady(page);

        await page.getByRole('button', { name: 'Lancer la manche' }).click();
        await waitForPlay(page);

        // Son déclenché par un bouton
        const before = (await audioLog(page)).length;
        await page.getByRole('button', { name: /^Son / }).first().click();
        await expectSoundPlayed(page, before);

        // Son aléatoire du jeu (ou du bot) sans toucher l'écran
        const afterTap = (await audioLog(page)).length;
        await expect.poll(async () => (await audioLog(page)).length, { timeout: 20_000 }).toBeGreaterThan(afterTap);
        expect((await audioLog(page)).every((e) => e.loaded && e.state === 'running')).toBe(true);

        // Un rire termine la manche (sauf si le bot a craqué avant : la manche est finie dans les deux cas)
        await setFace(page, LAUGH);
        await expect(page.getByRole('heading', { name: /Tu perds|Tu gagnes|Égalité/ })).toBeVisible({ timeout: 10_000 });
      } finally {
        await p.close();
      }
    });
  });
}
