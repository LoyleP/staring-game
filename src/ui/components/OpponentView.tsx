import type { Expression } from '../../game/fakeOpponent';
import styles from './OpponentView.module.css';

/** Stand-in du flux vidéo adverse : un visage simulé qui réagit aux expressions du bot. */
export function OpponentView({ expression }: { expression: Expression }) {
  const mouth =
    expression === 'smile'
      ? 'M 70 135 Q 100 165 130 135'
      : expression === 'laugh'
        ? 'M 65 130 Q 100 190 135 130 Z'
        : 'M 78 142 L 122 142';
  const eyesClosed = expression === 'smile' || expression === 'laugh';
  return (
    <div className={styles.view} data-expression={expression}>
      <svg viewBox="0 0 200 240" className={styles.face} aria-label="Adversaire simulé">
        <ellipse cx="100" cy="115" rx="78" ry="98" fill="#f3c7a6" />
        {eyesClosed ? (
          <>
            <path d="M 55 95 Q 70 82 85 95" stroke="#2b1b14" strokeWidth="5" fill="none" strokeLinecap="round" />
            <path d="M 115 95 Q 130 82 145 95" stroke="#2b1b14" strokeWidth="5" fill="none" strokeLinecap="round" />
          </>
        ) : (
          <g className={styles.eyes}>
            <ellipse cx="70" cy="95" rx="9" ry="12" fill="#2b1b14" />
            <ellipse cx="130" cy="95" rx="9" ry="12" fill="#2b1b14" />
          </g>
        )}
        <path d={mouth} stroke="#7a2e2e" strokeWidth="5" fill={expression === 'laugh' ? '#5a1c1c' : 'none'} strokeLinecap="round" />
      </svg>
      <span className={styles.name}>Bot</span>
    </div>
  );
}
