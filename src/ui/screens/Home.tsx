import { Link } from 'react-router-dom';

export function Home() {
  return (
    <main style={{ display: 'grid', placeItems: 'center', height: '100%', alignContent: 'center', gap: 24 }}>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Aura Duel</h1>
      <Link to="/solo" style={{ color: 'var(--aura-me)' }}>Mode solo (bac à sable)</Link>
    </main>
  );
}
