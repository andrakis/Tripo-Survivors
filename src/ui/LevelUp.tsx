// The level-up toast: the announcement for a level that is NEWS rather than a question.
//
// Since M4a there are two kinds of level-up (DESIGN §6.3). A weapon level is news — the table is
// fixed and ordered, so there is nothing to choose and therefore no reason to stop the world, and
// the swarm arriving while you read it is the point. That is this component. A stat level asks a
// question, and asking one mid-fight would make it a reflex test, so it pauses and draws three
// cards instead — ui/LevelUpChoice.tsx. Both end by calling `announce`, so a card the player takes
// also gets a toast here.
//
// Either way this stays trivially safe: it subscribes to the 10 Hz store like every other DOM
// overlay and never touches the sim.
//
// The world-side half of the same event lives elsewhere: the camera shake (scene/CameraRig.tsx) and
// the aura BURST (`combat.auraBurst`, set by sim/progression.ts and drawn by scene/AuraRing.tsx).
// Feedback that only happens in the HUD is feedback the player misses, because during a fight they
// are not looking at the HUD — which is exactly what went wrong with the flare through M4, when the
// world-side signal was set on the field the aura's own pulse writes twice a second and was
// therefore invisible.

import { useUi } from '../store';

/** How long the toast stays up. Long enough to read four words mid-fight, short enough that back to
 *  back levels do not stack into a wall of text. */
const HOLD = 1.9;

export function LevelUp() {
  const level = useUi((s) => s.level);
  const unlock = useUi((s) => s.unlock);
  const lastLevelAt = useUi((s) => s.lastLevelAt);
  const runId = useUi((s) => s.runId);

  if (lastLevelAt < 0) return null;

  return (
    <>
      <style>{`
        @keyframes level-toast {
          0%   { opacity: 0; transform: translate(-50%, 14px) scale(0.94) }
          12%  { opacity: 1; transform: translate(-50%, 0) scale(1) }
          78%  { opacity: 1; transform: translate(-50%, 0) scale(1) }
          100% { opacity: 0; transform: translate(-50%, -18px) scale(1) }
        }
      `}</style>
      {/* Keyed on the TIME of the level-up (and the run), so React rebuilds the element and the CSS
          animation restarts. Two levels inside HOLD otherwise leave the second one invisible inside
          the first one's fade — the same trap the damage vignette in Hud.tsx exists to avoid. */}
      <div
        key={`${runId}:${lastLevelAt}`}
        style={{
          position: 'fixed',
          // Above centre, not on it: the player is at the centre of the screen and this must never
          // be the thing covering them (DESIGN §12 rule 1).
          top: '22%',
          left: '50%',
          zIndex: 11,
          pointerEvents: 'none',
          textAlign: 'center',
          color: '#ffe9a8',
          textShadow: '0 2px 10px #000c',
          animation: `level-toast ${HOLD}s ease-out forwards`,
        }}
      >
        <div style={{ font: '700 26px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 3 }}>
          LEVEL {level}
        </div>
        <div
          style={{
            marginTop: 4,
            font: '600 14px ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#e8ecf2',
          }}
        >
          {unlock}
        </div>
      </div>
    </>
  );
}
