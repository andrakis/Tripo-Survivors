// The HUD. Reads the COOL state tier only (docs/ARCHITECTURE.md §3) — the store is pushed at 10 Hz,
// and a health bar that updates ten times a second is indistinguishable from one that updates sixty.
//
// Selector-per-field rather than one `useUi()`: zustand re-renders a component when anything it
// subscribed to changes, and the game-over card must not re-render on every clock tick.

import { useUi } from '../store';

/** m:ss. The run clock is the score (DESIGN §4.3), so it gets read at a glance, not parsed. */
function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PANEL: React.CSSProperties = {
  position: 'fixed',
  top: 10,
  left: 12,
  zIndex: 10,
  pointerEvents: 'none',
  textShadow: '0 1px 3px #000a',
};

export function Hud() {
  const hp = useUi((s) => s.hp);
  const maxHp = useUi((s) => s.maxHp);
  const time = useUi((s) => s.time);
  const kills = useUi((s) => s.kills);
  const lastHitAt = useUi((s) => s.lastHitAt);

  const frac = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
  // Below a quarter the bar goes from "a number" to "the thing you are looking at".
  const low = frac <= 0.25;

  return (
    <>
      <style>{`
        @keyframes hit-vignette { from { opacity: 1 } to { opacity: 0 } }
        @keyframes hp-low { 0%,100% { opacity: 1 } 50% { opacity: 0.55 } }
      `}</style>

      {/* Damage vignette. Keyed on the TIME of the hit, so React tears the element down and builds a
          new one on every hit — which is what restarts the CSS animation. Two hits inside 0.6 s
          otherwise merge into one fade and the second one is invisible, and DESIGN §12 rule 4 is
          that the player must never ask "when did I lose that HP?". */}
      {lastHitAt >= 0 && (
        <div
          key={lastHitAt}
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9,
            pointerEvents: 'none',
            background:
              'radial-gradient(ellipse at center, #ff3b3000 38%, #ff3b3055 78%, #ff3b30aa 100%)',
            animation: 'hit-vignette 0.55s ease-out forwards',
          }}
        />
      )}

      <div style={PANEL}>
        <div
          style={{
            width: 220,
            height: 14,
            border: '1px solid #8fa0b866',
            background: '#0f131aaa',
            borderRadius: 3,
            overflow: 'hidden',
            animation: low ? 'hp-low 0.7s ease-in-out infinite' : undefined,
          }}
        >
          <div
            style={{
              width: `${frac * 100}%`,
              height: '100%',
              background: low ? '#ff3b30' : '#7fd15a',
              // Matches the 10 Hz push, so the bar glides between samples instead of stepping.
              transition: 'width 100ms linear',
            }}
          />
        </div>
        <div
          style={{
            marginTop: 6,
            font: '600 13px ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#c6d0de',
          }}
        >
          {clock(time)}
          <span style={{ color: '#8fa0b8' }}>{'  ·  '}</span>
          {kills} killed
        </div>
      </div>
    </>
  );
}
