// The camera. Two modes, one rig (docs/ARCHITECTURE.md §9).
//
// FOLLOW is the original and the default: a fixed offset with lag. It never rotates and never
// collides, so "W" is always the same world direction and every model is only ever seen from one
// angle band — which is why a viewer only has to make their Tripo export look good from
// three-quarters-above.
//
// ORBIT (M7) trades both of those away on purpose, so a viewer can walk around the model they just
// imported and so zooming out can show them the arena they are fighting in. See src/camera.ts for
// the state and the controls.
//
// The two modes differ in exactly one value — the offset from the follow point to the camera — and
// everything else here (the smoothing, the shake, the fog) runs identically for both. That is the
// reason this file did not fork in two when the second mode landed.

import { useEffect, useLayoutEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { FOG_FAR, FOG_NEAR, TUNING } from '../config';
import { attachCameraControls, orbit, useCamera } from '../camera';
import { game } from '../game';
import { setInputBasisYaw } from '../input';

export function CameraRig({ focus }: { focus: RefObject<THREE.Vector3> }) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);
  const scene = useThree((s) => s.scene);
  const mode = useCamera((s) => s.mode);

  const home = useMemo(() => new THREE.Vector3(...TUNING.CAM_OFFSET), []);
  // The smoothed point the camera looks at — the player, lagged. Kept SEPARATELY from
  // camera.position because both the orbit offset and the level-up shake are added on top of it:
  // smoothing the camera's own position would feed each frame's shake back into the next frame's
  // lerp, and the camera would drift off the player by however far it was last kicked.
  const follow = useRef(new THREE.Vector3());
  // The live offset from that point to the camera. Eased rather than assigned, which costs about
  // two frames of lag while dragging and buys a mode switch that glides instead of cutting.
  const cur = useRef(new THREE.Vector3(...TUNING.CAM_OFFSET));
  const target = useRef(new THREE.Vector3());
  const elapsed = useRef(0);

  useLayoutEffect(() => {
    camera.position.copy(home);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [camera, home]);

  useEffect(() => attachCameraControls(gl.domElement), [gl]);

  useFrame((_, dt) => {
    const step = Math.min(dt, 0.05);
    // 1 - exp(-k*dt), NOT a raw lerp(a, b, 0.1): the raw form makes stiffness a function of
    // framerate — subtly wrong at 144 Hz and badly wrong at 20 fps.
    follow.current.lerp(focus.current, 1 - Math.exp(-TUNING.CAM_STIFFNESS * step));

    if (mode === 'orbit') {
      // Spherical, with pitch measured up from the ground plane. At the home pose this is exactly
      // CAM_OFFSET, which is what makes entering orbit mode move the camera by nothing (camera.ts).
      const cp = Math.cos(orbit.pitch);
      target.current
        .set(Math.sin(orbit.yaw) * cp, Math.sin(orbit.pitch), Math.cos(orbit.yaw) * cp)
        .multiplyScalar(orbit.dist);
    } else {
      target.current.copy(home);
    }
    cur.current.lerp(target.current, 1 - Math.exp(-TUNING.ORBIT_EASE * step));

    camera.position.copy(follow.current).add(cur.current);
    // Aimed at the SMOOTHED follow point, not at `focus` directly. The distinction is the whole
    // reason the original rig refused to call lookAt every frame: against the raw target, the
    // direction wobbles by however far the smoothing is currently lagging, which reads as a
    // permanent gentle sway rather than as a bug. Against `follow` the direction is exactly
    // -offset, so it is stable by construction — and orbit mode, which must re-aim every frame,
    // gets to use the same call.
    camera.lookAt(follow.current);

    // Movement follows the camera we just rendered, so the controls can never disagree with the
    // picture — including part-way through a mode transition, when the eased offset is at neither
    // mode's angle. In follow mode this is atan2(0, 26) === 0 and input.ts short-circuits it.
    setInputBasisYaw(Math.atan2(cur.current.x, cur.current.z));

    // Fog tracks the camera distance in orbit mode. FOG_NEAR is a constant for the fixed rig only
    // because that rig's distance is a constant; zoom out past 40 units with a hardcoded near plane
    // and the player fades into the fog, which breaks the one rule the whole look rests on
    // (DESIGN §12 rule 1). Tying near to the distance also means zooming out genuinely reveals more
    // world, which is what makes the arena boundary findable at all.
    const fog = scene.fog as THREE.Fog | null;
    if (fog && (fog as THREE.Fog).isFog) {
      if (mode === 'orbit') {
        fog.near = cur.current.length() + TUNING.ORBIT_FOG_PAD;
        fog.far = fog.near + TUNING.ORBIT_FOG_SPAN;
      } else {
        fog.near = FOG_NEAR;
        fog.far = FOG_FAR;
      }
    }

    // Level-up shake. Two incommensurable frequencies rather than a random offset per frame: random
    // jitter at 60 Hz is aliasing, not motion, and it reads as the camera being broken instead of as
    // something having landed. The amplitude is a decaying value the sim owns, so the shake is over
    // in SHAKE_TIME however many frames that takes.
    //
    // Added AFTER lookAt, so the shake translates the camera without rotating the view.
    elapsed.current += dt;
    const s = game.prog.shake;
    if (s > 0) {
      const t = elapsed.current * TUNING.SHAKE_FREQ;
      const amp = s * s * TUNING.SHAKE_AMP; // squared: the tail falls away rather than stopping dead
      camera.position.x += Math.sin(t) * amp;
      camera.position.y += Math.sin(t * 1.7) * amp * 0.6;
    }
  });

  return null;
}
