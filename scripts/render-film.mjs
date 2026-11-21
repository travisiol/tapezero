// Render the film (H.264 + AAC), its poster, the hero poster and the share image.
//   npm run film:render
import { execSync } from 'node:child_process';
const run = (c) => { console.log('›', c); execSync(c, { stdio: 'inherit' }); };
run('node scripts/score.ts');
run('npx remotion render film/index.ts TapezeroFilm public/film/tapezero-film.mp4 --codec=h264 --crf=20 --audio-codec=aac --audio-bitrate=192k --pixel-format=yuv420p --gl=angle');
run('npx remotion still film/index.ts TapezeroFilm public/film/poster.jpg --frame=1000 --image-format=jpeg --jpeg-quality=88 --gl=angle');
run('npx remotion still film/index.ts HeroPoster public/hero-poster.jpg --image-format=jpeg --jpeg-quality=86 --gl=angle');
run('npx remotion still film/index.ts ShareImage public/og.jpg --image-format=jpeg --jpeg-quality=88 --gl=angle');
