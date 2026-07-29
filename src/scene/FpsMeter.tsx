// Frame-rate readout. Updates the DOM twice a second, deliberately bypassing React state — a
// setState at 60 Hz to display a framerate is a great way to change the framerate you're measuring.

import { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';

const UPDATE_INTERVAL = 0.5;

export function FpsMeter() {
  const el = useRef<HTMLDivElement | null>(null);
  const frames = useRef(0);
  const elapsed = useRef(0);

  useEffect(() => {
    const div = document.createElement('div');
    div.style.cssText =
      'position:fixed;top:8px;right:10px;z-index:10;font:600 13px ui-monospace,SFMono-Regular,Menlo,monospace;' +
      'color:#8fa0b8;pointer-events:none;text-shadow:0 1px 2px #0008';
    div.textContent = '– fps';
    document.body.appendChild(div);
    el.current = div;
    return () => {
      div.remove();
      el.current = null;
    };
  }, []);

  useFrame((_, dt) => {
    frames.current++;
    elapsed.current += dt;
    if (elapsed.current >= UPDATE_INTERVAL && el.current) {
      el.current.textContent = `${Math.round(frames.current / elapsed.current)} fps`;
      frames.current = 0;
      elapsed.current = 0;
    }
  });

  return null;
}
