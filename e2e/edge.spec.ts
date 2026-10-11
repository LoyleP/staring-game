import { expect, test } from '@playwright/test';
import { enterLobby, openPlayer, startDuel, waitForPlay } from './helpers';

test('troisième joueur refusé', async ({ request }) => {
  const host = await (await request.post('/api/rooms', { data: { action: 'create' } })).json();
  await request.post('/api/rooms', { data: { action: 'join', code: host.code } });
  const third = await openPlayer('webkit', { mobile: true });
  try {
    await third.page.goto(`/r/${host.code}`);
    await expect(third.page.getByText('Ce duel est déjà complet.')).toBeVisible();
  } finally {
    await third.close();
  }
});

test('code inconnu', async () => {
  const p = await openPlayer('chromium', { mobile: true });
  try {
    await p.page.goto('/r/ZZZZZZ');
    await expect(p.page.getByText(/n’existe pas ou a expiré/)).toBeVisible();
  } finally {
    await p.close();
  }
});

test('caméra refusée : message d’aide et bouton réessayer', async () => {
  // WebKit sans autorisation renvoie un vrai refus (NotAllowedError), comme Safari sur iPhone.
  const p = await openPlayer('webkit', { mobile: true, camera: false });
  try {
    await p.page.goto('/solo');
    await p.page.getByRole('button', { name: 'Activer la caméra' }).click();
    await expect(p.page.getByRole('heading', { name: 'Caméra refusée' })).toBeVisible();
    await expect(p.page.getByText(/Réglages › Safari › Caméra/)).toBeVisible();
    await expect(p.page.getByRole('button', { name: 'Réessayer' })).toBeVisible();
  } finally {
    await p.close();
  }
});

test('rechargement dans le salon : l’invité garde sa place', async () => {
  const host = await openPlayer('chromium');
  const guest = await openPlayer('webkit', { mobile: true });
  try {
    const code = await enterLobby(host);
    await enterLobby(guest, code);
    await guest.page.reload();
    await expect(guest.page.getByRole('button', { name: /Activer la caméra/ })).toBeVisible();
    await expect(guest.page.getByText('Ce duel est déjà complet.')).toHaveCount(0);
    await guest.page.getByRole('button', { name: /Activer la caméra/ }).click();
    for (const p of [host, guest]) await expect(p.page.getByText('Adversaire connecté')).toBeVisible({ timeout: 20_000 });
  } finally {
    await host.close();
    await guest.close();
  }
});

test('adversaire déconnecté en pleine manche : victoire par forfait après 15 s', async () => {
  const host = await openPlayer('webkit', { mobile: true });
  const guest = await openPlayer('chromium', { mobile: true });
  try {
    await startDuel(host, guest);
    await waitForPlay(host.page);
    await guest.close();
    await expect(host.page.getByText(/victoire par forfait dans/)).toBeVisible({ timeout: 10_000 });
    await expect(host.page.getByRole('heading', { name: 'Tu gagnes la partie' })).toBeVisible({ timeout: 25_000 });
    await expect(host.page.getByText('Forfait de l’adversaire')).toBeVisible();
  } finally {
    await host.close();
  }
});
