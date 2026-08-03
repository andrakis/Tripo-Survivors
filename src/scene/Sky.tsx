// A gradient sky, for the camera that can look at it.
//
// The fixed rig points 45° down and sees ground in almost every pixel, so through M6 the background
// was a flat fill of the fog colour and nothing was lost. Orbit mode can pitch to within 7° of the
// horizon, where the top half of the screen is entirely whatever the background happens to be — and
// a flat fill there reads as the scene having failed to draw rather than as a sky.
//
// It stays DARK, and darker than the ground, which is not how daylight works and is exactly right
// here. ART-STYLE's first rule is that the player is the brightest thing on screen; a daylit sky is
// a screenful of pixels brighter than the player, and no amount of tuning the cast recovers from
// that. The palette has always been dusk. The sky is where that finally becomes visible.

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { COLORS } from '../config';

/** Comfortably inside the camera's 400-unit far plane, and beyond anything the arena contains. */
const RADIUS = 320;

const VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// Below the horizon the mix is pinned at the fog colour, so the sky meets the fogged ground plane in
// exactly the same value from every angle and the seam between them does not exist. That identity is
// also why FOG must stay equal to GROUND (config.ts) — three things agree on one colour here.
const FRAG = /* glsl */ `
  uniform vec3 uHorizon;
  uniform vec3 uTop;
  varying vec3 vDir;
  void main() {
    float t = smoothstep(0.0, 0.45, vDir.y);
    gl_FragColor = vec4(mix(uHorizon, uTop, t), 1.0);
  }
`;

export function Sky() {
  const ref = useRef<THREE.Mesh>(null!);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          // THREE.Color converts an sRGB hex into the renderer's working space on construction, so
          // these arrive linear and the shader's mix happens in the space the mix looks right in.
          uHorizon: { value: new THREE.Color(COLORS.FOG) },
          uTop: { value: new THREE.Color(COLORS.SKY_TOP) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        side: THREE.BackSide,
        // A pure backdrop: it writes no depth and tests none, and draws before everything else. That
        // combination means it can never occlude the scene and the scene can never z-fight it,
        // whatever the camera's near and far planes are doing.
        depthWrite: false,
        depthTest: false,
        fog: false,
      }),
    [],
  );

  // Follows the camera, so the horizon stays at eye level wherever the player runs. Without this the
  // sphere is anchored at the origin and the gradient visibly tilts as you cross the arena.
  useFrame((state) => {
    ref.current.position.copy(state.camera.position);
  });

  return (
    <mesh ref={ref} material={material} renderOrder={-1000} frustumCulled={false}>
      <sphereGeometry args={[RADIUS, 32, 16]} />
    </mesh>
  );
}
