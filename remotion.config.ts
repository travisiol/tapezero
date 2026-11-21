import { Config } from '@remotion/cli/config';

Config.setChromiumOpenGlRenderer('angle');
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(92);
Config.setConcurrency(4);
// Windows MAX_PATH: when the project lives in a deep folder, point to a copy of chrome-headless-shell in a short path.
if (process.env.REMOTION_BROWSER_EXECUTABLE) Config.setBrowserExecutable(process.env.REMOTION_BROWSER_EXECUTABLE);
