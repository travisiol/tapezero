// TAPEZERO brand scene: coral glass zero on deep bordeaux, diffused orange light, fading dot grid.
// Shared by the landing hero (clock-driven) and the film (frame-driven via `t`).
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { edgeGeometry, zeroGeometry } from './zeroGeometry.ts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Entrance: the doubled edge drifts apart (0.5–1.5 s) then settles back (1.6–2.8 s). 0 = aligned, 1 = fully split. */
export function entranceSplit(t: number): number {
  return smooth(0.45, 1.45, t) * (1 - smooth(1.6, 2.8, t));
}

export interface ZeroSceneProps {
  /** Controlled time in seconds (film). Omit for clock-driven playback. */
  t?: number;
  /** Override the split amount 0..1 (film beats). */
  split?: number;
  /** Extra split pulses triggered by rewinds (clock mode). */
  pulseKey?: number;
  position?: [number, number, number];
  scale?: number;
  reduced?: boolean;
  /** Global intensity of the orange back-light (0..1.5). */
  glow?: number;
  /** Optional yaw spin (radians) — film close-ups. */
  spin?: number;
  backdrop?: boolean;
}

const backdropVert = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const backdropFrag = /* glsl */ `
varying vec2 vUv;
uniform vec2 uCenter; uniform float uAspect; uniform float uGlow;
void main(){
  vec3 deep = vec3(0.114,0.047,0.098);      // #1D0C19
  vec3 bord = vec3(0.196,0.071,0.129);      // #321221
  vec3 orange = vec3(1.0,0.408,0.286);      // #FF6849
  vec2 p = vUv; p.x *= uAspect;
  vec2 c = uCenter; c.x *= uAspect;
  float d = distance(p, c);
  vec3 col = mix(bord, deep, smoothstep(0.0, 0.9, d));
  // diffused orange light pooled under the symbol
  vec2 g = vec2(c.x, c.y - 0.22);
  float glow = exp(-pow(distance(p, g) * 2.6, 2.0)) * 0.55 * uGlow;
  col += orange * glow;
  // fading dot grid (upper area), like the logo
  vec2 grid = vUv * vec2(uAspect, 1.0) * 70.0;
  vec2 f = fract(grid) - 0.5;
  float dotm = 1.0 - smoothstep(0.05, 0.12, length(f));
  float fade = smoothstep(0.35, 0.95, vUv.y) * (1.0 - smoothstep(0.15, 0.75, abs(vUv.x - uCenter.x)));
  col += vec3(1.0,0.45,0.32) * dotm * fade * 0.22;
  gl_FragColor = vec4(col, 1.0);
}`;

function Backdrop({ center, glow }: { center: [number, number]; glow: number }) {
  const { viewport, camera } = useThree();
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: backdropVert,
        fragmentShader: backdropFrag,
        uniforms: { uCenter: { value: new THREE.Vector2(...center) }, uAspect: { value: 1 }, uGlow: { value: glow } },
        depthWrite: false,
      }),
    [],
  );
  const dist = 14;
  const vp = viewport.getCurrentViewport(camera, new THREE.Vector3(0, 0, -dist + (camera.position.z - 6)));
  mat.uniforms.uAspect.value = vp.width / vp.height;
  mat.uniforms.uCenter.value.set(...center);
  mat.uniforms.uGlow.value = glow;
  return (
    <mesh position={[0, 0, -8]} material={mat} renderOrder={-1}>
      <planeGeometry args={[vp.width * 1.05, vp.height * 1.05]} />
    </mesh>
  );
}

function Env() {
  const { gl, scene } = useThree();
  useLayoutEffect(() => {
    const pm = new THREE.PMREMGenerator(gl);
    const env = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = env;
    return () => {
      env.dispose();
      pm.dispose();
    };
  }, [gl, scene]);
  return null;
}

export function ZeroRig({ t, split, pulseKey = 0, position = [0, 0, 0], scale = 1, reduced, glow = 1, spin = 0, backdrop = true }: ZeroSceneProps) {
  const group = useRef<THREE.Group>(null);
  const edge = useRef<THREE.Mesh>(null);
  const ghost = useRef<THREE.Mesh>(null);
  const light = useRef<THREE.PointLight>(null);
  const geo = useMemo(() => zeroGeometry(), []);
  const egeo = useMemo(() => edgeGeometry(), []);
  const pulse = useRef({ key: pulseKey, at: -10 });
  const glass = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#FFC6AE'),
        roughness: 0.2,
        metalness: 0,
        transmission: 0.9,
        thickness: 1.7,
        ior: 1.42,
        attenuationColor: new THREE.Color('#FF6424'),
        attenuationDistance: 0.6,
        clearcoat: 1,
        clearcoatRoughness: 0.07,
        emissive: new THREE.Color('#FF5522'),
        emissiveIntensity: 0.15,
        sheen: 0.25,
        sheenColor: new THREE.Color('#FFF0E7'),
        sheenRoughness: 0.5,
        envMapIntensity: 1.1,
      }),
    [],
  );
  const coral = useMemo(
    () =>
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color('#FF7656'),
        roughness: 0.22,
        transmission: 0.55,
        ior: 1.4,
        attenuationColor: new THREE.Color('#FF3D2E'),
        attenuationDistance: 0.5,
        thickness: 0.5,
        clearcoat: 1,
        clearcoatRoughness: 0.2,
        emissive: new THREE.Color('#FF4E3A'),
        emissiveIntensity: 0.3,
        envMapIntensity: 1,
      }),
    [],
  );
  const ghostMat = useMemo(() => {
    const m = new THREE.MeshStandardMaterial({ color: '#FF6849', emissive: new THREE.Color('#FF6849'), emissiveIntensity: 0.55, roughness: 0.35, transparent: true, opacity: 0, depthWrite: false, envMapIntensity: 0.4 });
    return m;
  }, [coral]);

  const apply = (time: number) => {
    const g = group.current;
    if (!g) return;
    if (pulseKey !== pulse.current.key) pulse.current = { key: pulseKey, at: time };
    const sinceP = time - pulse.current.at;
    const pulseSplit = sinceP >= 0 && sinceP < 1.1 ? Math.sin((sinceP / 1.1) * Math.PI) * 0.75 : 0;
    const s = reduced ? 0 : (split ?? Math.max(entranceSplit(time), pulseSplit));
    const intro = reduced ? 1 : smooth(0, 0.9, time);
    const idle = reduced ? 0 : Math.sin(time * 0.6);
    g.position.set(position[0], position[1] + idle * 0.03 + (1 - intro) * -0.15, position[2]);
    g.rotation.set(0.1 + idle * 0.015, -0.42 + spin + (1 - intro) * -0.35 + Math.sin(time * 0.35) * (reduced ? 0 : 0.03), -0.06);
    g.scale.setScalar(scale * (0.94 + 0.06 * intro));
    if (edge.current) {
      edge.current.position.set(0.05 + s * 0.17, 0.045 + s * 0.13, 0.12 + s * 0.24);
      edge.current.rotation.z = -s * 0.05;
    }
    if (ghost.current) {
      ghost.current.position.set(0.05 + s * 0.34, 0.045 + s * 0.26, 0.1 + s * 0.12);
      (ghost.current.material as THREE.MeshStandardMaterial).opacity = s * 0.32;
      ghost.current.visible = s > 0.01;
    }
    glass.emissiveIntensity = 0.06 + 0.1 * intro;
    if (light.current) light.current.intensity = (14 + 4 * s) * glow * intro;
  };
  useFrame((st) => {
    if (t === undefined) apply(st.clock.elapsedTime);
  });
  useLayoutEffect(() => {
    if (t !== undefined) apply(t);
  });

  return (
    <>
      <Env />
      {backdrop && <Backdrop center={[0.5 + position[0] * 0.08, 0.52 + position[1] * 0.08]} glow={glow} />}
      <ambientLight intensity={0.15} color="#FFB394" />
      <directionalLight position={[-3, 4, 5]} intensity={1.6} color="#FFF0E7" />
      <directionalLight position={[4, -2, 2]} intensity={0.5} color="#FF8738" />
      <group ref={group}>
        <mesh geometry={geo} material={glass} />
        <mesh ref={edge} geometry={egeo} material={coral} />
        <mesh ref={ghost} geometry={egeo} material={ghostMat} />
        <pointLight ref={light} position={[0.1, -0.2, -0.9]} color="#FF6A30" distance={6} decay={1.6} />
        <pointLight position={[0.2, 0.3, 1.6]} intensity={2.2} color="#FFB394" distance={5} />
        <pointLight position={[0.9, -1.1, 1.1]} intensity={7} color="#FF7A2E" distance={4} decay={1.5} />
      </group>
    </>
  );
}
