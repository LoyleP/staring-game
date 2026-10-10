import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { gameConfig } from '../../game/gameConfig';
import { SoloSession } from '../../game/solo';
import { useSoloStore } from '../../game/store';
import { permissionHelp } from '../../vision/camera';
import { AuraGauge } from '../components/AuraGauge';
import { DebugOverlay } from '../components/DebugOverlay';
import styles from './Solo.module.css';

export function Solo() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [session, setSession] = useState<SoloSession | null>(null);
  const [params] = useSearchParams();
  const debug = params.get('debug') === '1';
  const { screen, message, calibProgress, snap, floaters } = useSoloStore();

  useEffect(() => {
    if (!videoRef.current) return;
    const s = new SoloSession(videoRef.current, debug);
    setSession(s);
    return () => s.dispose();
  }, [debug]);

  const live = screen === 'calibrating' || screen === 'ready' || screen === 'running' || screen === 'ended';

  return (
    <main className={styles.root}>
      <video ref={videoRef} className={styles.video} data-live={live} playsInline autoPlay muted />
      {screen === 'running' && <DebugOverlay />}

      {screen === 'prepare' && (
        <section className={styles.panel}>
          <h1>Mode solo</h1>
          <p>Reste neutre et immobile : tu gagnes de l’aura. Sourire, rire ou bouger t’en coûte.</p>
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
            <p>Visage neutre, ne bouge pas</p>
            {message && <p className={styles.small}>{message}</p>}
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

      {screen === 'running' && snap && (
        <>
          <header className={styles.hud}>
            <AuraGauge label="Toi" aura={snap.aura} />
            <div className={styles.timer}>{Math.ceil(snap.timeLeftMs / 1000)}</div>
          </header>
          {snap.phase === 'countdown' && <div className={styles.big}>{snap.countdown}</div>}
          {snap.phase === 'grace' && <div className={styles.hint}>Prêt… la pénalité commence</div>}
          {snap.phase === 'play' && snap.flags.faceLost && <div className={styles.alert}>Visage perdu !</div>}
          {snap.phase === 'play' && snap.flags.smiling && <div className={styles.alert}>Tu souris</div>}
          {snap.phase === 'play' && snap.flags.headMoving && <div className={styles.alert}>Ne bouge pas</div>}
          {floaters.map((f) => (
            <div key={f.id} className={styles.floater}>{f.delta}</div>
          ))}
        </>
      )}

      {screen === 'ended' && snap && (
        <section className={styles.panel}>
          <h1>{snap.ended === 'time' ? 'Manche tenue !' : snap.ended === 'crack' ? 'Tu as craqué' : 'Aura épuisée'}</h1>
          <p className={styles.score}>{Math.round(snap.aura)} aura</p>
          <p className={styles.small}>Durée : {Math.round(Math.min(snap.elapsedMs, gameConfig.round.durationMs) / 1000)} s</p>
          <button onClick={() => session?.startRound()}>Rejouer</button>
          <button onClick={() => session?.startCalibration()}>Recalibrer</button>
        </section>
      )}
    </main>
  );
}
