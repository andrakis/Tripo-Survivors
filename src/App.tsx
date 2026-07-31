import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import { FpsMeter } from './scene/FpsMeter';
import { TouchControls } from './ui/TouchControls';
import { Hud } from './ui/Hud';
import { LevelUp } from './ui/LevelUp';
import { GameOver } from './ui/GameOver';
import { TUNING } from './config';

export function App() {
  return (
    <>
      <Canvas
        camera={{ fov: TUNING.CAM_FOV, position: [...TUNING.CAM_OFFSET], near: 0.5, far: 400 }}
        dpr={[1, 2]}
        gl={{ antialias: true }}
      >
        <Scene />
        <FpsMeter />
      </Canvas>

      {/* DOM overlays, outside the Canvas. They subscribe to the 10 Hz store, so they re-render on a
          human clock and never on the sim's (ARCHITECTURE §3). TouchControls renders itself away on
          a fine pointer (ARCHITECTURE §8). */}
      <Hud />
      <LevelUp />
      <TouchControls />
      <GameOver />
    </>
  );
}
