import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, createRoom } from '../../net/api';
import { ROOM_CODE_RE } from '../../net/protocol';
import styles from './Home.module.css';

export function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const room = await createRoom();
      navigate(`/r/${room.code}`);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 429 ? 'Trop de duels créés, réessaie plus tard.' : 'Impossible de créer le duel.');
      setBusy(false);
    }
  };

  const join = () => {
    const c = code.trim().toUpperCase();
    if (!ROOM_CODE_RE.test(c)) return setError('Le code contient 6 caractères.');
    navigate(`/r/${c}`);
  };

  return (
    <main className={styles.root}>
      <h1 className={styles.logo}>Aura Duel</h1>
      <p className={styles.tag}>Le premier qui sourit perd son aura.</p>

      <button className={styles.primary} onClick={create} disabled={busy}>
        {busy ? 'Création…' : 'Créer un duel'}
      </button>

      <div className={styles.join}>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
          placeholder="CODE"
          inputMode="text"
          autoCapitalize="characters"
          autoComplete="off"
          aria-label="Code du duel"
          onKeyDown={(e) => e.key === 'Enter' && join()}
        />
        <button onClick={join}>Rejoindre</button>
      </div>
      {error && <p className={styles.error}>{error}</p>}

      <Link to="/solo" className={styles.solo}>Mode solo (bac à sable)</Link>
    </main>
  );
}
