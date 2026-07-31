// The HUD. Reads the COOL state tier only (docs/ARCHITECTURE.md §3) — the store is pushed at 10 Hz,
// and a health bar that updates ten times a second is indistinguishable from one that updates sixty.
//
// Selector-per-field rather than one `useUi()`: zustand re-renders a component when anything it
// subscribed to changes, and the game-over card must not re-render on every clock tick.

import { BOOSTS } from '../config';
import { useUi } from '../store';

/** Hex int -> css. The boost tints live in config.ts as numbers, next to the sim that reads them. */
const css = (hex: number) => `#${hex.toString(16).padStart(6, '0')}`;

/** m:ss. The run clock is the score (DESIGN §4.3), so it gets read at a glance, not parsed. */
function clock(t: number): string {
  const s = Math.floor(t);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const PANEL: React.CSSProperties = {
  position: 'fixed',
  // Clear of the XP strip pinned across the very top.
  top: 20,
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
  const level = useUi((s) => s.level);
  const xp = useUi((s) => s.xp);
  const xpNeed = useUi((s) => s.xpNeed);
  const boostTimers = useUi((s) => s.boostTimers);
  const dashCd = useUi((s) => s.dashCd);
  const dashCdMax = useUi((s) => s.dashCdMax);

  const frac = maxHp > 0 ? Math.max(0, hp / maxHp) : 0;
  // Below a quarter the bar goes from "a number" to "the thing you are looking at".
  const low = frac <= 0.25;
  const xpFrac = xpNeed > 0 ? Math.min(1, xp / xpNeed) : 0;
  const dashReady = dashCd <= 0;
  const dashFrac = dashCdMax > 0 ? 1 - Math.min(1, dashCd / dashCdMax) : 1;

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

      {/* XP: a full-width strip across the very top edge, deliberately unlike the HP bar. They are
          read at completely different moments — HP is checked under pressure, XP is glanced at
          between waves — and giving them the same shape in the same corner would make the wrong one
          the thing the eye lands on. Progress toward the NEXT level, so it always fills and resets;
          the running total is on the game-over card, where a total is worth something. */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 5,
          zIndex: 10,
          pointerEvents: 'none',
          background: '#0f131acc',
        }}
      >
        <div
          style={{
            width: `${xpFrac * 100}%`,
            height: '100%',
            background: '#8fe3ff',
            boxShadow: '0 0 8px #8fe3ffaa',
            transition: 'width 100ms linear',
          }}
        />
      </div>

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
          <span style={{ color: '#8fa0b8' }}>{'  ·  '}</span>
          <span style={{ color: '#8fe3ff' }}>lv {level}</span>
        </div>

        {/* Dash. A meter rather than a number, and it goes SOLID when ready — the player checks this
            with peripheral vision during a fight, and "is it full" is readable there in a way that
            "1.4" is not. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
          <span
            style={{
              font: '700 10px ui-monospace, SFMono-Regular, Menlo, monospace',
              letterSpacing: 1,
              color: dashReady ? '#ffe9a8' : '#8fa0b8',
            }}
          >
            DASH
          </span>
          <div
            style={{
              width: 84,
              height: 5,
              borderRadius: 3,
              background: '#0f131aaa',
              border: '1px solid #8fa0b833',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                width: `${dashFrac * 100}%`,
                height: '100%',
                background: dashReady ? '#ffe9a8' : '#8fa0b8',
                transition: 'width 100ms linear',
              }}
            />
          </div>
        </div>
      </div>

      {/* Active boosts (DESIGN §6.4). Bottom-centre, away from the HP corner: these are good news on
          a clock, and putting them where the player looks for bad news would cost a glance. The
          countdown is shown because the whole decision a boost creates — press the advantage or play
          safe — is a function of how long is left. */}
      {boostTimers.some((t) => t > 0) && (
        <div
          style={{
            position: 'fixed',
            bottom: 18,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10,
            pointerEvents: 'none',
            display: 'flex',
            gap: 8,
          }}
        >
          {boostTimers.map((t, kind) =>
            t > 0 ? (
              <div
                key={BOOSTS[kind].id}
                style={{
                  padding: '5px 10px',
                  borderRadius: 4,
                  background: '#0f131add',
                  border: `1px solid ${css(BOOSTS[kind].tint)}aa`,
                  color: css(BOOSTS[kind].tint),
                  font: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
                  letterSpacing: 1,
                  // Flashes over the last three seconds, so the boost running out is something the
                  // player sees coming rather than discovers by taking a hit.
                  animation: t < 3 ? 'hp-low 0.4s ease-in-out infinite' : undefined,
                }}
              >
                {BOOSTS[kind].label} {Math.ceil(t)}
              </div>
            ) : null,
          )}
        </div>
      )}
    </>
  );
}
