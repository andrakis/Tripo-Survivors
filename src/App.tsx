import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import { FpsMeter } from './scene/FpsMeter';
import { TouchControls } from './ui/TouchControls';
import { Hud } from './ui/Hud';
import { LevelUp } from './ui/LevelUp';
import { LevelUpChoice } from './ui/LevelUpChoice';
import { BoostToast } from './ui/BoostToast';
import { GameOver } from './ui/GameOver';
import { TUNING } from './config';

export function App() {
  return (
    <>
      <Canvas
        camera={{ fov: TUNING.CAM_FOV, position: [...TUNING.CAM_OFFSET], near: 0.5, far: 400 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
        // Dev-only debug seam, like window.__game: the verification run walks the scene graph to
        // assert on renderer state the sim cannot see (e.g. that the VAT row attribute is live).
        onCreated={(state) => {
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
      <LevelUp />
      <BoostToast />
      <TouchControls />
      <LevelUpChoice />
      <GameOver />
    </>
  );
}
