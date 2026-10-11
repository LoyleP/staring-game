import { gameConfig } from '../../game/gameConfig';
import type { RoundSnapshot } from '../../game/machine';
import type { Floater } from '../../game/store';
import { AuraGauge } from './AuraGauge';
import styles from '../screens/Solo.module.css';

const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

interface Props {
  snap: RoundSnapshot;
  floaters: Floater[];
  oppLabel: string;
  /** Texte à côté du minuteur (ex. "Manche 2 · 1-0"). */
  title?: string;
  suddenDeath?: boolean;
}

/** Affichage de manche commun au solo et au duel : minuteur, jauges au centre, compte à rebours, alertes. */
export function MatchHud({ snap, floaters, oppLabel, title, suddenDeath }: Props) {
  const startAura = gameConfig.round.startAura;
  return (
    <>
      <header className={styles.top}>
        <span className={styles.pill}>
          {title ?? oppLabel} · {suddenDeath ? 'Mort subite ' : ''}
          {clock(snap.timeLeftMs)}
        </span>
      </header>

      <div className={styles.mid}>
        <AuraGauge side="opp" label={oppLabel} aura={snap.oppAura ?? 0} max={startAura} />
        <AuraGauge side="me" label="Toi" aura={snap.aura} max={startAura} />
        {floaters.map((f) => (
          <div key={f.id} className={styles.floater} data-side={f.side}>
            {f.delta}
          </div>
        ))}
      </div>

      {snap.phase === 'countdown' && <div className={styles.big}>{snap.countdown}</div>}
      {snap.phase === 'grace' && <div className={styles.hint}>Prêt…</div>}
      <div className={styles.alerts}>
        {snap.phase === 'play' && snap.flags.faceLost && <span className={styles.alert}>Visage perdu !</span>}
        {snap.phase === 'play' && snap.flags.smiling && <span className={styles.alert}>Tu souris</span>}
        {snap.phase === 'play' && snap.flags.headMoving && <span className={styles.alert}>Ne bouge pas</span>}
      </div>
    </>
  );
}
