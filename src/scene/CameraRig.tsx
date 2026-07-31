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
import { game } from '../game';

export function CameraRig({ focus }: { focus: RefObject<THREE.Vector3> }) {
  const camera = useThree((s) => s.camera);
  const offset = useMemo(() => new THREE.Vector3(...TUNING.CAM_OFFSET), []);
  const desired = useRef(new THREE.Vector3());
  // The smoothed follow position, kept SEPARATELY from camera.position because the level-up shake is
  // added on top of it. Shaking camera.position directly would feed the displacement back into next
  // frame's lerp, and the camera would drift off the player by however far it was last kicked.
  const base = useRef(new THREE.Vector3(...TUNING.CAM_OFFSET));
  const elapsed = useRef(0);

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
    base.current.lerp(desired.current, k);

    // Level-up shake. Two incommensurable frequencies rather than a random offset per frame: random
    // jitter at 60 Hz is aliasing, not motion, and it reads as the camera being broken instead of as
    // something having landed. The amplitude is a decaying value the sim owns, so the shake is over
    // in SHAKE_TIME however many frames that takes.
    elapsed.current += dt;
    const s = game.prog.shake;
    if (s > 0) {
      const t = elapsed.current * TUNING.SHAKE_FREQ;
      const amp = s * s * TUNING.SHAKE_AMP; // squared: the tail falls away rather than stopping dead
      camera.position.set(
        base.current.x + Math.sin(t) * amp,
        base.current.y + Math.sin(t * 1.7) * amp * 0.6,
        base.current.z,
      );
    } else {
      camera.position.copy(base.current);
    }
  });

  return null;
}
