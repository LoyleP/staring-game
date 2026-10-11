import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { RoomSession } from '../../game/room';
import { useRoomStore } from '../../game/roomStore';
import { permissionHelp } from '../../vision/camera';
import solo from './Solo.module.css';
import styles from './Room.module.css';

const statusText = (peerPresent: boolean, connection: string, remoteVideo: boolean) => {
  if (!peerPresent) return 'En attente de l’adversaire…';
  if (connection === 'connected' && remoteVideo) return 'Adversaire connecté';
  if (connection === 'reconnecting') return 'Reconnexion…';
  if (connection === 'failed') return 'Connexion impossible';
  return 'Connexion à l’adversaire…';
};

export function Room() {
  const { code = '' } = useParams();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const debug = params.get('debug') === '1';
  const localRef = useRef<HTMLVideoElement>(null);
  const remoteRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<RoomSession | null>(null);
  const [consent, setConsent] = useState(false);
  const [copied, setCopied] = useState(false);
  const s = useRoomStore();

  useEffect(() => {
    if (!localRef.current || !remoteRef.current) return;
    const room = new RoomSession(code.toUpperCase(), localRef.current, remoteRef.current);
    setSession(room);
    void room.init();
    return () => room.dispose();
  }, [code]);

  const link = `${location.origin}/r/${s.code}`;
  const share = async () => {
    try {
      if (navigator.share) {
        await navigator.share({ title: 'Aura Duel', text: 'Rejoins mon duel d’aura !', url: link });
        return;
      }
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // partage annulé
    }
  };

  const inCall = s.screen === 'call';
  const live = s.screen === 'lobby' || inCall;

  return (
    <main className={solo.root}>
      <video ref={remoteRef} className={styles.remote} data-on={inCall} playsInline autoPlay />
      <video
        ref={localRef}
        className={solo.video}
        data-mode={inCall ? 'pip' : 'full'}
        data-live={live}
        playsInline
        autoPlay
        muted
      />

      {s.screen === 'joining' && <section className={solo.panel}><p>Connexion au duel…</p></section>}

      {s.screen === 'error' && (
        <section className={solo.panel}>
          <h1>Oups</h1>
          <p>{s.error}</p>
          <Link to="/" className={styles.link}>Retour à l’accueil</Link>
        </section>
      )}

      {s.screen === 'prepare' && (
        <section className={solo.panel}>
          <h1>Duel {s.code}</h1>
          <ul className={styles.rules}>
            <li><b>Reste neutre.</b> Sourire, rire ou bouger te fait perdre de l’aura.</li>
            <li><b>Provoque.</b> Grimaces et sons : ils peuvent faire craquer ton adversaire… ou toi.</li>
            <li><b>2 manches gagnantes.</b> 60 secondes par manche.</li>
          </ul>
          <label className={styles.consent}>
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            J’accepte que le moment de mon craquage soit capturé
          </label>
          <p className={solo.small}>
            Ta vidéo passe directement d’un téléphone à l’autre. L’analyse du visage reste sur ton appareil : rien n’est enregistré.
          </p>
          <button onClick={() => session?.activate(consent)}>Activer caméra et micro</button>
        </section>
      )}

      {s.screen === 'loading' && <section className={solo.panel}><p>Activation de la caméra…</p></section>}

      {s.screen === 'denied' && (
        <section className={solo.panel}>
          <h1>Caméra ou micro refusé</h1>
          <p>{permissionHelp()}</p>
          <button onClick={() => session?.activate(consent)}>Réessayer</button>
        </section>
      )}

      {s.screen === 'lobby' && (
        <section className={solo.bottom}>
          <div className={styles.code}>{s.code}</div>
          <button className={styles.share} onClick={share}>{copied ? 'Lien copié ✓' : 'Partager le lien'}</button>
          <p className={styles.status} data-ok={s.connection === 'connected' && s.remoteVideo}>
            {statusText(s.peerPresent, s.connection, s.remoteVideo)}
          </p>
          {s.peerReady && <p className={solo.small}>Ton adversaire est prêt.</p>}
          {s.signalingDegraded && <p className={solo.warn}>Réseau instable</p>}
          <button disabled={!s.peerPresent} onClick={() => session?.setReady(!s.meReady)}>
            {s.meReady ? 'Prêt ✓ (annuler)' : 'Prêt'}
          </button>
        </section>
      )}

      {inCall && (
        <>
          <header className={solo.top}>
            <span className={solo.pill}>
              {statusText(s.peerPresent, s.connection, s.remoteVideo)}
              {debug && s.rtt !== null ? ` · ${s.rtt} ms` : ''}
            </span>
          </header>
          <footer className={solo.controls}>
            <button
              className={solo.end}
              aria-label="Quitter"
              onClick={() => {
                session?.leave();
                navigate('/');
              }}
            >
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
                <path d="M12 9c-3.3 0-6.4 1-8.6 2.8-.4.4-.5 1-.1 1.4l1.6 2c.3.4.9.5 1.3.2l2.4-1.5c.3-.2.5-.5.5-.9V12c1.5-.5 3.5-.5 5 0v1c0 .4.2.7.5.9l2.4 1.5c.4.3 1 .2 1.3-.2l1.6-2c.4-.4.3-1-.1-1.4C18.4 10 15.3 9 12 9z" />
              </svg>
            </button>
          </footer>
        </>
      )}
    </main>
  );
}
