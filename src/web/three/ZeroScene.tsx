// TAPEZERO brand object: a slanted, puffy glass zero whose upper-right edge is doubled like two successive frames.
// One deterministic shader (no refraction buffers, no environment maps): identical in the hero, the poster and the film.
import { useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { zeroGeometry, ZERO, SLANT } from './zeroGeometry.ts';

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Entrance: the edge layer drifts apart (0.5–1.3 s) then settles back onto its rest offset (1.4–2.4 s). */
export function entranceSplit(t: number): number {
  return smooth(0.5, 1.3, t) * (1 - smooth(1.4, 2.4, t));
}

const vert = /* glsl */ `
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;
void main() {
  vObj = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
uniform vec3 uLight;      // key light direction (world)
uniform vec3 uA;          // top-left colour (peach cream)
uniform vec3 uB;          // bottom-right colour (orange)
uniform vec3 uRim;        // rim / highlight colour (cream)
uniform float uLayer;     // 0 = body, 1 = doubled edge layer
uniform float uOpacity;
uniform vec2 uHalf;       // outer half size
uniform float uR;         // outer corner radius
uniform float uSlant;
varying vec3 vObj;
varying vec3 vN;
varying vec3 vV;

float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

void main() {
  vec3 N = normalize(vN);
  vec3 V = normalize(vV);
  vec3 L = normalize(uLight);
  // diagonal gradient, cream at the top-left, orange at the bottom-right
  float g = clamp(0.5 + (vObj.x * 0.42 - vObj.y * 0.36), 0.0, 1.0);
  vec3 base = mix(uA, uB, g);
  // soft wrap lighting, never black
  float wrap = (dot(N, L) + 0.6) / 1.6;
  vec3 col = base * (0.62 + 0.45 * wrap);
  // translucent glow: thick, inward-facing areas get warmer and brighter
  float facing = max(dot(N, V), 0.0);
  col += uB * 0.22 * pow(1.0 - facing, 1.5);
  // broad soft highlight + crisp one, from the top-left
  vec3 H = normalize(L + V);
  float nh = max(dot(N, H), 0.0);
  col += uRim * (0.28 * pow(nh, 18.0) + 0.95 * pow(nh, 160.0));
  // cream fresnel rim
  float fr = pow(1.0 - facing, 3.0);
  col = mix(col, uRim, fr * 0.45);
  float a = uOpacity;
  if (uLayer > 0.5) {
    // keep only the upper-right part of the outer rim
    vec2 p = vec2(vObj.x - vObj.y * uSlant, vObj.y);
    float sd = sdRoundBox(p, uHalf, uR);              // ~0 on the outer contour, negative inside
    float band = smoothstep(-0.6, -0.42, sd);          // outer band of the ring
    float sector = smoothstep(0.45, 0.85, p.x * 0.6 + p.y * 0.8);
    a *= band * sector;
    col = mix(col, vec3(1.0, 0.36, 0.24) * (0.75 + 0.5 * wrap), 0.62) + uRim * 0.6 * pow(nh, 60.0);        // coral tint
    if (a < 0.01) discard;
  }
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

function makeMat(layer: number) {
  return new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    transparent: layer > 0,
    depthWrite: layer === 0,
    uniforms: {
      uLight: { value: new THREE.Vector3(-0.55, 0.75, 0.9) },
      uA: { value: new THREE.Color('#FFD2BE') },
      uB: { value: new THREE.Color('#FF7436') },
      uRim: { value: new THREE.Color('#FFF0E7') },
      uLayer: { value: layer },
      uOpacity: { value: 1 },
      uHalf: { value: new THREE.Vector2(ZERO.W / 2 + 0.2, ZERO.H / 2 + 0.2) },
      uR: { value: ZERO.R + 0.2 },
      uSlant: { value: SLANT },
    },
  });
}

export interface ZeroSceneProps {
  /** Controlled time in seconds (film, poster). Omit for clock-driven playback. */
  t?: number;
  /** Override the split amount 0..1 (film beats). */
  split?: number;
  /** Increment to trigger a split pulse (rewinds in the landing replay). */
  pulseKey?: number;
  position?: [number, number, number];
  scale?: number;
  reduced?: boolean;
  /** Optional extra yaw (radians). */
  spin?: number;
  /** Entrance fade (set false for stills). */
  intro?: boolean;
}

export function ZeroRig({ t, split, pulseKey = 0, position = [0, 0, 0], scale = 1, reduced, spin = 0, intro = true }: ZeroSceneProps) {
  const group = useRef<THREE.Group>(null);
  const layer1 = useRef<THREE.Mesh>(null);
  const layer2 = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => zeroGeometry(), []);
  const body = useMemo(() => makeMat(0), []);
  const m1 = useMemo(() => makeMat(1), []);
  const m2 = useMemo(() => makeMat(1), []);
  const pulse = useRef({ key: pulseKey, at: -10 });

  const apply = (time: number) => {
    const g = group.current;
    if (!g) return;
    if (pulseKey !== pulse.current.key) pulse.current = { key: pulseKey, at: time };
    const sinceP = time - pulse.current.at;
    const pulseSplit = sinceP >= 0 && sinceP < 0.9 ? Math.sin((sinceP / 0.9) * Math.PI) : 0;
    const s = reduced ? 0 : (split ?? Math.max(intro ? entranceSplit(time) : 0, pulseSplit));
    const k = reduced || !intro ? 1 : smooth(0, 0.8, time);
    const idle = reduced ? 0 : Math.sin(time * 0.55);
    g.position.set(position[0], position[1] + idle * 0.025 - (1 - k) * 0.12, position[2]);
    g.rotation.set(0.06 + idle * 0.01, -0.32 + spin + (1 - k) * -0.25, -0.04);
    g.scale.setScalar(scale * (0.96 + 0.04 * k));
    body.uniforms.uOpacity.value = 1;
    // rest offset = the logo's doubled edge; split pushes it further, a second echo appears
    if (layer1.current) layer1.current.position.set(0.075 + s * 0.16, 0.065 + s * 0.13, 0.12 + s * 0.12);
    m1.uniforms.uOpacity.value = 0.95;
    if (layer2.current) {
      layer2.current.position.set(0.055 + s * 0.34, 0.05 + s * 0.27, 0.06 + s * 0.2);
      layer2.current.visible = s > 0.02;
    }
    m2.uniforms.uOpacity.value = 0.45 * s;
  };
  useFrame((st) => {
    if (t === undefined) apply(st.clock.elapsedTime);
  });
  useLayoutEffect(() => {
    if (t !== undefined) apply(t);
  });

  return (
    <group ref={group}>
      <mesh geometry={geo} material={body} renderOrder={0} />
      <mesh ref={layer2} geometry={geo} material={m2} renderOrder={1} />
      <mesh ref={layer1} geometry={geo} material={m1} renderOrder={2} />
    </group>
  );
}
