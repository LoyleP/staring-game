import styles from './AuraGauge.module.css';

interface Props {
  label: string;
  aura: number;
  max: number;
  side: 'me' | 'opp';
}

export function AuraGauge({ label, aura, max, side }: Props) {
  const pct = Math.max(0, Math.min(1, aura / max));
  return (
    <div className={styles.gauge} data-side={side}>
      <strong className={styles.value}>{Math.round(aura)}</strong>
      <div className={styles.track}>
        <div className={styles.fill} style={{ transform: `scaleX(${pct})` }} />
      </div>
      <span className={styles.label}>{label}</span>
    </div>
  );
}
