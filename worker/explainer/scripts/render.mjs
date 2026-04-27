import { bundle } from '@remotion/bundler';
import { renderMedia, selectComposition, openBrowser } from '@remotion/renderer';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const finalOut = process.argv[2] || '/mnt/documents/slip-explainer_v2.mp4';
const silentOut = '/tmp/explainer-silent.mp4';
const audioPath = path.resolve(__dirname, '../public/voiceover.mp3');

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

console.log(`▶ Rendering silent video → ${silentOut}`);
await renderMedia({
  composition,
  serveUrl: bundled,
  codec: 'h264',
  outputLocation: silentOut,
  puppeteerInstance: browser,
  // Render muted — Remotion forces libfdk_aac which the Nix ffmpeg lacks.
  // We mux the voiceover back in with system ffmpeg below.
  muted: true,
  concurrency: 1,
  onProgress: ({ progress }) => {
    if (progress * 100 % 10 < 1) process.stdout.write(`  ${(progress * 100).toFixed(0)}%\n`);
  },
});

await browser.close({ silent: false });

console.log(`▶ Muxing voiceover → ${finalOut}`);
execSync(
  `ffmpeg -y -i "${silentOut}" -i "${audioPath}" -c:v copy -c:a aac -b:a 192k -shortest "${finalOut}"`,
  { stdio: 'inherit' },
);
console.log(`✓ wrote ${finalOut}`);