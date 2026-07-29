import { Canvas } from '@react-three/fiber';
import { Scene } from './scene/Scene';
import { FpsMeter } from './scene/FpsMeter';
import { TUNING } from './config';

export function App() {
  return (
    <Canvas
      camera={{ fov: TUNING.CAM_FOV, position: [...TUNING.CAM_OFFSET], near: 0.5, far: 400 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      <Scene />
      <FpsMeter />
    </Canvas>
  );
}
