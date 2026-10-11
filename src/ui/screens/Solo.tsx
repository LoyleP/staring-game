import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { SoloSession } from '../../game/solo';
import { useSoloStore } from '../../game/store';
import { permissionHelp } from '../../vision/camera';
import { SoundButton } from '../components/SoundButton';
import { MatchHud } from '../components/MatchHud';
import { DebugOverlay } from '../components/DebugOverlay';
import { OpponentView } from '../components/OpponentView';
import styles from './Solo.module.css';

export function Solo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<SoloSession | null>(null);
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const debug = params.get('debug') === '1';
  const { screen, message, calibProgress, snap, floaters, oppExpression, hand, reload } = useSoloStore();

  useEffect(() => {
    if (!videoRef.current) return;
    const s = new SoloSession(videoRef.current, debug);
    setSession(s);
    return () => s.dispose();
  }, [debug]);

  const inCall = screen === 'running' || screen === 'ended';
  const live = inCall || screen === 'calibrating' || screen === 'ready';
  const cracked = snap?.winner === 'me' && snap.ended === 'crack';

  return (
    <main className={styles.root}>
      {inCall && <OpponentView expression={cracked ? 'laugh' : oppExpression} />}
      <video
        ref={videoRef}
        className={styles.video}
        data-mode={inCall ? 'pip' : 'full'}
        data-live={live}
        playsInline
        autoPlay
        muted
      />
      {screen === 'running' && <DebugOverlay />}

      {screen === 'prepare' && (
        <section className={styles.panel}>
          <h1>Mode solo</h1>
          <p>Affronte un adversaire simulé : reste neutre, fais-le craquer avant qu’il ne te fasse craquer.</p>
          <p className={styles.small}>
            L’analyse du visage tourne sur ton téléphone. Aucune image ni donnée faciale n’est envoyée ou conservée.
          </p>
          <button onClick={() => session?.activate()}>Activer la caméra</button>
          <Link to="/">Retour</Link>
        </section>
      )}

      {screen === 'loading' && <section className={styles.panel}><p>Chargement du détecteur…</p></section>}

      {screen === 'denied' && (
        <section className={styles.panel}>
          <h1>Caméra refusée</h1>
          <p>{permissionHelp()}</p>
          <button onClick={() => session?.activate()}>Réessayer</button>
        </section>
      )}

      {screen === 'error' && (
        <section className={styles.panel}>
          <h1>Impossible de démarrer</h1>
          <p className={styles.small}>{message}</p>
          <button onClick={() => session?.activate()}>Réessayer</button>
        </section>
      )}

      {screen === 'calibrating' && (
        <>
          <div className={styles.oval} />
          <section className={styles.bottom}>
            <p>Remplis l’ovale, visage neutre, ne bouge pas</p>
            {message && <p className={styles.warn}>{message}</p>}
            <progress value={calibProgress} max={1} />
          </section>
        </>
      )}

      {screen === 'ready' && (
        <section className={styles.bottom}>
          <p>Calibration validée.</p>
          <button onClick={() => session?.startRound()}>Lancer la manche</button>
        </section>
      )}

      {screen === 'running' && snap && <MatchHud snap={snap} floaters={floaters} oppLabel="Bot" />}

      {inCall && (
        <footer className={styles.controls}>
          <button
            className={styles.end}
            aria-label="Quitter"
            onClick={() => {
              session?.dispose();
              navigate('/');
            }}
          >
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden>
              <path d="M12 9c-3.3 0-6.4 1-8.6 2.8-.4.4-.5 1-.1 1.4l1.6 2c.3.4.9.5 1.3.2l2.4-1.5c.3-.2.5-.5.5-.9V12c1.5-.5 3.5-.5 5 0v1c0 .4.2.7.5.9l2.4 1.5c.4.3 1 .2 1.3-.2l1.6-2c.4-.4.3-1-.1-1.4C18.4 10 15.3 9 12 9z" />
            </svg>
          </button>
          {screen === 'running' &&
            hand.map((card, i) => (
              <SoundButton
                key={card.sound.id}
                label={card.sound.label}
                used={card.used}
                reload={reload}
                disabled={snap?.phase !== 'play'}
                onFire={() => session?.fireSound(i)}
              />
            ))}
        </footer>
      )}

      {screen === 'ended' && snap && (
        <section className={styles.result}>
          <h1>
            {snap.winner === 'me' ? 'Tu gagnes' : snap.winner === 'opp' ? 'Tu perds' : 'Égalité'}
          </h1>
          <p className={styles.small}>
            {snap.ended === 'crack'
              ? snap.winner === 'me'
                ? 'Le bot a craqué'
                : 'Tu as craqué'
              : snap.ended === 'zero'
                ? 'Aura épuisée'
                : 'Au temps'}
          </p>
          <p className={styles.score}>
            {Math.round(snap.aura)} <span>vs</span> {Math.round(snap.oppAura ?? 0)}
          </p>
          <button onClick={() => session?.startRound()}>Rejouer</button>
          <button className={styles.secondary} onClick={() => session?.startCalibration()}>Recalibrer</button>
        </section>
      )}
    </main>
  );
}
