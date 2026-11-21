import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import * as THREE from 'three';
import { ZeroRig } from './ZeroScene.tsx';

/** Hero 3D canvas. Loaded lazily after the page content; the poster stays underneath until the first frame. */
export default function HeroCanvas({ reduced, onReady }: { reduced: boolean; onReady: () => void }) {
  const [pulse, setPulse] = useState(0);
  const [wide, setWide] = useState(() => window.innerWidth >= 900);
  useEffect(() => {
    const onRw = () => setPulse((p) => p + 1);
    const onRs = () => setWide(window.innerWidth >= 900);
    window.addEventListener('tapezero:rewind', onRw);
    window.addEventListener('resize', onRs);
    return () => {
      window.removeEventListener('tapezero:rewind', onRw);
      window.removeEventListener('resize', onRs);
    };
  }, []);
  return (
    <Canvas
      className="hero-canvas"
      dpr={[1, 1.75]}
      camera={{ position: [0, 0, 6], fov: 30 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.05, powerPreference: 'high-performance' }}
      frameloop={reduced ? 'demand' : 'always'}
      onCreated={() => requestAnimationFrame(() => onReady())}
      aria-hidden="true"
    >
      <ZeroRig position={wide ? [1.35, 0.05, 0] : [0.05, 0.78, 0]} scale={wide ? 1 : 0.42} reduced={reduced} pulseKey={pulse} />
    </Canvas>
  );
}
