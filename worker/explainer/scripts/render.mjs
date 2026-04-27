import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const out = process.argv[2] || '/mnt/documents/slip-explainer_v2.mp4';

console.log('▶ Bundling…');
const bundled = await bundle({
  entryPoint: path.resolve(__dirname, '../src/index.ts'),
  webpackOverride: (c) => c,
});

console.log('▶ Launching headless Chromium…');
const browser = await openBrowser('chrome', {
  browserExecutable: process.env.PUPPETEER_EXECUTABLE_PATH || '/bin/chromium',
  chromiumOptions: { args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage'] },
  chromeMode: 'chrome-for-testing',
});

console.log('▶ Selecting composition…');
const composition = await selectComposition({
  serveUrl: bundled,
  id: 'explainer',
  puppeteerInstance: browser,
});
console.log(`  duration: ${composition.durationInFrames} frames @ ${composition.fps}fps = ${(composition.durationInFrames / composition.fps).toFixed(2)}s`);

console.log(`▶ Rendering → ${out}`);
await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: out,
  puppeteerInstance: browser,
  // Need audio: keep voiceover. Nix ffmpeg supports aac, just not libfdk_aac.
  muted: false,
  audioCodec: 'aac',
  concurrency: 1,
  onProgress: ({ progress }) => {
    if (progress * 100 % 10 < 1) process.stdout.write(`  ${(progress * 100).toFixed(0)}%\n`);
  },
});

await browser.close({ silent: false });
console.log(`✓ wrote ${out}`);