// The boost pickup announcement (DESIGN §6.4). A toast, not a modal — a boost changes the rules but
// it does not ask a question, and the fifteen seconds it grants start whether you have read it or
// not.
//
// It exists alongside the HUD's chip row because the two answer different questions. The chip
// answers "how long have I got"; this answers "what just happened", once, at the moment the player
// ran over something and the arithmetic changed. Without it the only evidence of a pickup is a small
// label appearing at the bottom of the screen, which during a fight is no evidence at all.

import { BOOSTS } from '../config';
import { useUi } from '../store';

const HOLD = 1.6;

export function BoostToast() {
  const at = useUi((s) => s.lastBoostAt);
  const kind = useUi((s) => s.lastBoostKind);
  const runId = useUi((s) => s.runId);

  if (at < 0 || kind < 0 || kind >= BOOSTS.length) return null;
  const boost = BOOSTS[kind];
  const tint = `#${boost.tint.toString(16).padStart(6, '0')}`;

  return (
    <>
      <style>{`
        @keyframes boost-toast {
          0%   { opacity: 0; transform: translate(-50%, 10px) scale(0.96) }
          10%  { opacity: 1; transform: translate(-50%, 0) scale(1) }
          70%  { opacity: 1; transform: translate(-50%, 0) scale(1) }
          100% { opacity: 0; transform: translate(-50%, -14px) scale(1) }
        }
      `}</style>
      {/* Keyed on the pickup TIME, so grabbing a second boost restarts the animation instead of
          landing invisibly inside the first one's fade — the pattern the damage vignette and the
          level toast both use. */}
      <div
        key={`${runId}:${at}`}
        style={{
          position: 'fixed',
          // Below centre, mirroring the level toast above it: two announcements that can overlap in
          // time must never overlap in space.
          top: '64%',
          left: '50%',
          zIndex: 11,
          pointerEvents: 'none',
          textAlign: 'center',
          color: tint,
          textShadow: '0 2px 10px #000c',
          animation: `boost-toast ${HOLD}s ease-out forwards`,
        }}
      >
        <div style={{ font: '700 20px ui-monospace, SFMono-Regular, Menlo, monospace', letterSpacing: 3 }}>
          {boost.label}
        </div>
        <div
          style={{
            marginTop: 3,
            font: '600 12px ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#e8ecf2',
          }}
        >
          {boost.detail}
        </div>
      </div>
    </>
  );
}
