import styles from './AuraGauge.module.css';

export function AuraGauge({ label, aura, max = 2000 }: { label: string; aura: number; max?: number }) {
  const pct = Math.max(0, Math.min(1, aura / max));
  return (
    <div className={styles.gauge}>
      <div className={styles.row}>
        <span>{label}</span>
        <strong>{Math.round(aura)}</strong>
      </div>
      <div className={styles.track}>
        <div className={styles.fill} style={{ transform: `scaleX(${pct})` }} />
      </div>
    </div>
  );
}
