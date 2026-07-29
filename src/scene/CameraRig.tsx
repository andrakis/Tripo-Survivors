// Third-person follow camera: a fixed offset, with lag. That is the entire system.
//
// It never rotates, never orbits, and never collides with anything (docs/ARCHITECTURE.md §9).
// A fixed world yaw means "W" is always the same world direction, and — the reason that matters
// for this project — every model is only ever seen from one angle band, so a viewer only has to
// make their Tripo export look good from three-quarters-above.

import { useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { TUNING } from '../config';

export function CameraRig({ focus }: { focus: RefObject<THREE.Vector3> }) {
  const camera = useThree((s) => s.camera);
  const offset = useMemo(() => new THREE.Vector3(...TUNING.CAM_OFFSET), []);
  const desired = useRef(new THREE.Vector3());

  // The rotation is computed ONCE and then left alone. Calling lookAt(focus) every frame would
  // wobble the pitch as the smoothed position lags behind the target — a subtle, permanent sway
  // that reads as motion sickness rather than as a bug.
  useLayoutEffect(() => {
    camera.position.copy(offset);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, offset]);

  useFrame((_, dt) => {
    desired.current.copy(focus.current).add(offset);
    // 1 - exp(-k*dt), NOT a raw lerp(a, b, 0.1): the raw form makes stiffness a function of
    // framerate — subtly wrong at 144 Hz and badly wrong at 20 fps.
    const k = 1 - Math.exp(-TUNING.CAM_STIFFNESS * Math.min(dt, 0.05));
    camera.position.lerp(desired.current, k);
  });

  return null;
}
