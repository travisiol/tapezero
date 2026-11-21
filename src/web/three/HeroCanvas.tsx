import { useEffect, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import { ZeroRig } from './ZeroScene.tsx';

/** Hero 3D canvas, loaded after the page content. Transparent: the bordeaux, glow and dot grid are CSS. */
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
      dpr={[1, 2]}
      camera={{ position: [0, 0, 6], fov: 30 }}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      frameloop={reduced ? 'demand' : 'always'}
      onCreated={() => onReady()}
      aria-hidden="true"
    >
      <ZeroRig position={wide ? [1.3, 0, 0] : [0, 0.8, 0]} scale={wide ? 0.95 : 0.42} reduced={reduced} pulseKey={pulse} />
    </Canvas>
  );
}
