import { Composition, Still } from 'remotion';
import { Film, PosterStill } from './Film.tsx';
import { FPS } from './cues.ts';

export function Root() {
  return (
    <>
      <Composition id="TapezeroFilm" component={Film} durationInFrames={35 * FPS} fps={FPS} width={1920} height={1080} />
      <Still id="HeroPoster" component={() => <PosterStill w={1920} h={1080} />} width={1920} height={1080} />
      <Still id="ShareImage" component={() => <PosterStill w={1200} h={630} title />} width={1200} height={630} />
    </>
  );
}
