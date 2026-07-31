// The upgrade choice (DESIGN §6.3). The only screen in the game with a decision on it, and — with
// the game-over card — one of only two that stop the run.
//
// It pauses deliberately. Every other piece of feedback in this game is designed NOT to interrupt:
// the level-up toast, the aura flare, the shake. This one interrupts because it asks a question, and
// asking a question while a crowd closes in turns a choice into a reflex test. The freeze is in the
// sim (`stepGame` short-circuits on `prog.offer`), so what sits behind these cards is the exact
// frame the level landed on.
//
// Keyboard-first: the player's hands are on WASD and the dash key. 1/2/3 take a card without
// reaching for a mouse, which is also how the whole run has been played up to this point.

import { useEffect } from 'react';
import { chooseUpgrade } from '../sim/progression';
import { game } from '../game';
import { useUi } from '../store';

const KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];

export function LevelUpChoice() {
  const offers = useUi((s) => s.offers);
  const level = useUi((s) => s.level);
  const open = offers.length > 0;

  // The store is a snapshot pushed at 10 Hz, so the pick has to go straight to the sim rather than
  // through the store — and the sim's own syncStore is what takes the card back down.
  const take = (index: number) => {
    chooseUpgrade(game.prog, game, index, game.time);
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const i = KEYS.indexOf(e.code);
      if (i < 0 || i >= offers.length) return;
      e.preventDefault();
      take(i);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, offers.length]);

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 19, // under the game-over card: dying while a choice is up ends the run, not the choice
        display: 'grid',
        placeItems: 'center',
        background: '#0f131abb',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{ textAlign: 'center', color: '#e8ecf2' }}>
        <div
          style={{
            font: '700 13px ui-monospace, SFMono-Regular, Menlo, monospace',
            letterSpacing: 3,
            color: '#8fe3ff',
            marginBottom: 16,
          }}
        >
          LEVEL {level} — CHOOSE ONE
        </div>

        <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
          {offers.map((o, i) => (
            <button
              key={o.id}
              autoFocus={i === 0}
              onClick={() => take(i)}
              style={{
                width: 210,
                minHeight: 116,
                padding: '16px 14px',
                borderRadius: 8,
                cursor: 'pointer',
                textAlign: 'left',
                background: '#1c2027f2',
                border: '1px solid #8fa0b855',
                boxShadow: '0 18px 60px #0009',
                color: '#e8ecf2',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <span
                style={{
                  font: '700 11px ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: '#8fa0b8',
                  letterSpacing: 2,
                }}
              >
                {i + 1}
              </span>
              <span style={{ font: '700 15px ui-monospace, SFMono-Regular, Menlo, monospace' }}>
                {o.label}
              </span>
              <span
                style={{
                  font: '500 12px ui-monospace, SFMono-Regular, Menlo, monospace',
                  color: '#8fa0b8',
                  lineHeight: 1.4,
                }}
              >
                {o.detail}
              </span>
            </button>
          ))}
        </div>

        <div
          style={{
            marginTop: 14,
            font: '500 11px ui-monospace, SFMono-Regular, Menlo, monospace',
            color: '#8fa0b8',
          }}
        >
          press 1–{offers.length}
        </div>
      </div>
    </div>
  );
}
