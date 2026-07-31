// Virtual thumbstick, left half of the screen. Writes the SAME normalised vector the keyboard
// writes (src/input.ts), so there is exactly one movement code path (docs/ARCHITECTURE.md §8).
//
// Floating origin, not a fixed pad: the stick appears wherever the thumb lands. A fixed pad has to
// be found by looking, and on a game where the only verb is "where you stand", looking away from
// the crowd to locate a control is a death.
//
// The knob is moved by writing `transform` on refs rather than through React state. A pointermove
// stream is ~60 Hz, and pushing it through `useState` re-renders on every sample for a purely
// visual position — the same reason the sim never touches React (ARCHITECTURE §3).

import { useEffect, useMemo, useRef } from 'react';
import { queueDash, setTouchVector } from '../input';

/** Pixels of travel for full deflection. Roughly a thumb's comfortable arc without lifting. */
const STICK_R = 56;

/** Coarse pointer, or `?touch=1` so it can be demonstrated on a desktop (ARCHITECTURE §8). */
function shouldShow(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).has('touch')) return true;
  return window.matchMedia('(pointer: coarse)').matches;
}

export function TouchControls() {
  const enabled = useMemo(shouldShow, []);
  const stick = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  // Which pointer owns the stick. A second finger (the other thumb, a palm) must not steal it.
  const owner = useRef<number | null>(null);
  // Where the thumb landed, in client pixels. Kept here rather than read back off the element:
  // offsetLeft on a `position: fixed` node is measured against its offsetParent, which is only
  // incidentally the viewport today and would silently skew the whole stick if anything upstream
  // ever became a positioned ancestor.
  const origin = useRef({ x: 0, y: 0 });

  // The vector is module state, so a component that unmounts mid-drag would leave the player
  // running forever. Cheap insurance for a component that is conditionally rendered.
  useEffect(() => () => setTouchVector(0, 0), []);

  if (!enabled) return null;

  const move = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    // Clamp the DEFLECTION, not the vector: past full travel the stick pins to its rim and keeps
    // reporting 1.0, instead of the thumb sliding off and the character stopping.
    const scale = len > STICK_R ? STICK_R / len : 1;
    const kx = dx * scale;
    const ky = dy * scale;
    if (knob.current) knob.current.style.transform = `translate(${kx - 24}px, ${ky - 24}px)`;
    // Screen-down is +Z, matching the keyboard mapping in input.ts.
    setTouchVector(kx / STICK_R, ky / STICK_R);
  };

  const onDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (owner.current !== null) return;
    owner.current = e.pointerId;
    origin.current.x = e.clientX;
    origin.current.y = e.clientY;
    e.currentTarget.setPointerCapture(e.pointerId);
    if (stick.current) {
      stick.current.style.left = `${e.clientX}px`;
      stick.current.style.top = `${e.clientY}px`;
      stick.current.style.opacity = '1';
    }
    move(0, 0);
  };

  const onMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (owner.current !== e.pointerId) return;
    move(e.clientX - origin.current.x, e.clientY - origin.current.y);
  };

  const onUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (owner.current !== e.pointerId) return;
    owner.current = null;
    if (stick.current) stick.current.style.opacity = '0';
    setTouchVector(0, 0);
  };

  return (
    <>
      {/* The capture surface: left half, invisible, above the canvas. */}
      <div
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '50%',
          height: '100%',
          zIndex: 5,
          touchAction: 'none',
        }}
      />

      {/* Dash, on the RIGHT half — the thumb that is not driving. It queues the same edge the space
          bar does (src/input.ts), so there is one dash code path exactly as there is one movement
          one. `pointerdown` rather than a click: a tap-to-click round trip is ~100 ms of latency on
          an action whose whole value is that it happens now. */}
      <div
        onPointerDown={(e) => {
          e.preventDefault();
          queueDash();
        }}
        style={{
          position: 'fixed',
          right: 28,
          bottom: 40,
          width: 92,
          height: 92,
          borderRadius: '50%',
          zIndex: 6,
          touchAction: 'none',
          border: '2px solid #ffe9a877',
          background: '#0f131a55',
          color: '#ffe9a8cc',
          display: 'grid',
          placeItems: 'center',
          font: '700 13px ui-monospace, SFMono-Regular, Menlo, monospace',
          letterSpacing: 2,
          userSelect: 'none',
        }}
      >
        DASH
      </div>

      {/* The stick itself. pointerEvents none so it never intercepts from the surface above. */}
      <div
        ref={stick}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: 0,
          height: 0,
          zIndex: 6,
          opacity: 0,
          transition: 'opacity 120ms ease-out',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{
            position: 'absolute',
            width: STICK_R * 2,
            height: STICK_R * 2,
            left: -STICK_R,
            top: -STICK_R,
            borderRadius: '50%',
            border: '2px solid #8fa0b855',
            background: '#0f131a33',
          }}
        />
        <div
          ref={knob}
          style={{
            position: 'absolute',
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: '#ffe9a8cc',
            transform: 'translate(-24px, -24px)',
          }}
        />
      </div>
    </>
  );
}
