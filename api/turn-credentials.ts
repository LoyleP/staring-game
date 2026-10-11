import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { IceServerConfig } from '../src/net/protocol.js';

/**
 * Serveurs ICE. Le STUN public est toujours présent ; le TURN vient des variables d'environnement
 * TURN_URLS (séparées par des virgules), TURN_USERNAME et TURN_CREDENTIAL. Rien n'est écrit en dur côté client.
 * TODO : générer des identifiants temporaires (1 h) quand le fournisseur TURN de production sera choisi.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const iceServers: IceServerConfig[] = [{ urls: ['stun:stun.l.google.com:19302'] }];
  const urls = (process.env.TURN_URLS ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  if (urls.length && process.env.TURN_USERNAME && process.env.TURN_CREDENTIAL) {
    iceServers.push({ urls, username: process.env.TURN_USERNAME, credential: process.env.TURN_CREDENTIAL });
  }
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({ iceServers, turn: iceServers.length > 1 });
}
