import { useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import { FpsMeter } from './scene/FpsMeter';
import { TouchControls } from './ui/TouchControls';
import { Hud } from './ui/Hud';
import { LevelUp } from './ui/LevelUp';
import { LevelUpChoice } from './ui/LevelUpChoice';
import { BoostToast } from './ui/BoostToast';
import { GameOver } from './ui/GameOver';
import { ModelPicker } from './ui/ModelPicker';
import { CameraToggle } from './ui/CameraToggle';
import { TUNING } from './config';

export function App() {
  // The model dialog is a GATE, not an overlay: nothing below mounts until it is dismissed.
  //
  // That is what lets a viewer swap a model from it. Every renderer under scene/ reads its geometry
  // once, at mount, and holds it imperatively for the life of the run (ARCHITECTURE §3) — so the
  // only safe moment to replace one is before any of them exists. Gating also means the run clock
  // does not start while somebody is reading the dialog, which is the difference between a startup
  // screen and thirty seconds of unattended enemies.
  const [playing, setPlaying] = useState(false);
  if (!playing) return <ModelPicker onStart={() => setPlaying(true)} />;

  return (
    <>
      <Canvas
        camera={{ fov: TUNING.CAM_FOV, position: [...TUNING.CAM_OFFSET], near: 0.5, far: 400 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        // Dev-only debug seam, like window.__game: the verification run walks the scene graph to
        // assert on renderer state the sim cannot see (e.g. that the VAT row attribute is live).
        // `data-game` marks THIS canvas: the model dialog draws canvases of its own, so "a canvas
        // exists" stopped being the same statement as "the game is running" (scripts/drive.mjs).
        onCreated={(state) => {
          state.gl.domElement.dataset.game = '1';
          if (import.meta.env.DEV) (window as unknown as { __r3f: unknown }).__r3f = state;
        }}
      >
        <Scene />
        <FpsMeter />
      </Canvas>

      {/* DOM overlays, outside the Canvas. They subscribe to the 10 Hz store, so they re-render on a
          human clock and never on the sim's (ARCHITECTURE §3). TouchControls renders itself away on
          a fine pointer (ARCHITECTURE §8). */}
      <Hud />
      <CameraToggle />
      <LevelUp />
      <BoostToast />
      <TouchControls />
      <LevelUpChoice />
      <GameOver />
    </>
  );
}
