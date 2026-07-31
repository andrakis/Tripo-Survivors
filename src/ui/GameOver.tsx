// The game-over card. A run ends in death — there is no win state (DESIGN §4.3) — and the score is
// the clock.
//
// Deliberately the only modal surface in the game. There is no pause screen and no options screen,
// so this component is also the entire answer to "how do I start again": one button, always focused,
// and Enter or Space works without finding it.

import { useEffect } from 'react';
import { game, resetGame } from '../game';
import { useUi } from '../store';

const ROW: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  gap: 32,
  font: '600 15px ui-monospace, SFMono-Regular, Menlo, monospace',
  padding: '5px 0',
};

function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export function GameOver() {
  const dead = useUi((s) => s.dead);
  const time = useUi((s) => s.time);
  const kills = useUi((s) => s.kills);
  const level = useUi((s) => s.level);
  const xp = useUi((s) => s.xp);

  // Restart on Enter/Space as well as the button. The player's hands are on WASD, and making them
  // find a mouse to do the one thing this screen offers is a bad end to every run.
  useEffect(() => {
    if (!dead) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        resetGame(game);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dead]);

  if (!dead) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 20,
        display: 'grid',
        placeItems: 'center',
        background: '#0f131aaa',
        // The field is frozen behind this, not paused mid-animation — game.ts stops stepping on
        // death, so what you see under the card is the exact frame that killed you.
        backdropFilter: 'blur(2px)',
      }}
    >
      <div
        style={{
          minWidth: 280,
          padding: '22px 26px',
          borderRadius: 8,
          background: '#1c2027f2',
          border: '1px solid #8fa0b855',
          boxShadow: '0 18px 60px #0009',
          color: '#e8ecf2',
        }}
      >
        <div
          style={{
            font: '700 13px ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: 2,
            color: '#d1585a',
            marginBottom: 14,
          }}
        >
          YOU DIED
        </div>

        <div style={ROW}>
          <span style={{ color: '#8fa0b8' }}>survived</span>
          <span>{clock(time)}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: '#8fa0b8' }}>killed</span>
          <span>{kills}</span>
        </div>
        <div style={ROW}>
          <span style={{ color: '#8fa0b8' }}>level</span>
          <span>
            {level}
            <span style={{ color: '#8fa0b8' }}>{`  (${xp} xp)`}</span>
          </span>
        </div>

        <button
          autoFocus
          onClick={() => resetGame(game)}
          style={{
            marginTop: 18,
            width: '100%',
            padding: '10px 0',
            borderRadius: 5,
            border: 'none',
            cursor: 'pointer',
            background: '#ffe9a8',
            color: '#1c2027',
            font: '700 14px ui-monospace, SFMono-Regular, Menlo, monospace',
          }}
        >
          RUN AGAIN
        </button>
      </div>
    </div>
  );
}
