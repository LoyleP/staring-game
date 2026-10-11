import styles from './SoundButton.module.css';

interface Props {
  label: string;
  used: boolean;
  /** 0 = recharge en cours, 1 = prêt. */
  reload: number;
  disabled: boolean;
  onFire: () => void;
}

export function SoundButton({ label, used, reload, disabled, onFire }: Props) {
  const reloading = !used && reload < 1;
  return (
    <button
      className={styles.btn}
      data-used={used}
      data-reloading={reloading}
      disabled={disabled || used}
      style={{ '--p': reload } as React.CSSProperties}
      onClick={onFire}
      aria-label={`Son ${label}${used ? ' utilisé' : ''}`}
    >
      <span className={styles.inner}>{used ? '–' : label}</span>
    </button>
  );
}
