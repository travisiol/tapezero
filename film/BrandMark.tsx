// Opening/closing mark: the official logo (public/brand/logo.png) when present, else the 3D zero.
import { AbsoluteFill, Img, getStaticFiles, staticFile } from 'remotion';
import { ThreeCanvas } from '@remotion/three';
import { ZeroRig } from '../src/web/three/ZeroScene.tsx';

export const hasLogo = () => getStaticFiles().some((f) => f.name === 'brand/logo.png');

/** split 0..1: the logo separates into two successive frames (offset echoes), then realigns at 0. */
export function BrandMark({ t, split, size, y = 0 }: { t: number; split: number; size: number; y?: number }) {
  if (!hasLogo()) {
    return (
      <ThreeCanvas width={1920} height={1080} camera={{ position: [0, 0, 6], fov: 30 }} gl={{ antialias: true, alpha: true, preserveDrawingBuffer: true }}>
        <ZeroRig t={t} split={split} scale={size / 1700} position={[0, y / 330, 0]} intro={false} />
      </ThreeCanvas>
    );
  }
  const src = staticFile('brand/logo.png');
  const mask = 'radial-gradient(circle at 50% 50%, #000 52%, transparent 71%)';
  const img = (dx: number, dy: number, o: number) => (
    <Img src={src} style={{ position: 'absolute', width: size, height: size, left: 960 - size / 2 + dx, top: 540 - size / 2 - y + dy, opacity: o, WebkitMaskImage: mask, maskImage: mask, mixBlendMode: o < 1 ? 'screen' : 'normal' }} />
  );
  return (
    <AbsoluteFill>
      {split > 0.01 && img(split * 46, -split * 36, 0.35 * split)}
      {split > 0.01 && img(split * 23, -split * 18, 0.55 * split)}
      {img(0, 0, 1)}
    </AbsoluteFill>
  );
}
