// Generate voiceover.mp3 + word timings JSON for the explainer video.
// Uses ElevenLabs TTS (mp3) + alignment endpoint for per-word timings.

import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, '../public');
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error('ELEVENLABS_API_KEY missing');
  process.exit(1);
}

// Single continuous VO — beats are derived from word timings later.
// Sentences map 1:1 to scenes 1-5.
const SCRIPT = [
  "Drop any parlay slip — screenshot or text.",
  "Eight engines cross-reference every leg in parallel: Unified P V S, Median Lock, Juiced Props, Last Ten hit rates, sharp money, trap probability, injuries, and fatigue.",
  "Each leg gets a verdict — keep, swap, or drop — with a sharper Over or Under built from real consensus, not a guess.",
  "Weak legs come back with a stronger alternative and a projected expected value gain.",
  "Approve once. Broadcast to every subscriber in a tap.",
].join(' ');

// Voice: "Brian" — low, confident, narration-friendly
const VOICE_ID = 'nPczCjzI2devNBz1zQrb';

async function main() {
  await mkdir(PUBLIC_DIR, { recursive: true });

  // 1. Use the with-timestamps endpoint to get audio + per-character alignment in one call.
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}/with-timestamps?output_format=mp3_44100_128`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'xi-api-key': API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: SCRIPT,
      model_id: 'eleven_multilingual_v2',
      voice_settings: { stability: 0.55, similarity_boost: 0.8, style: 0.35, use_speaker_boost: true, speed: 1.02 },
    }),
  });

  if (!resp.ok) {
    console.error('TTS failed:', resp.status, await resp.text());
    process.exit(1);
  }

  const data = await resp.json();
  // data.audio_base64, data.alignment.{characters, character_start_times_seconds, character_end_times_seconds}
  const audioBuf = Buffer.from(data.audio_base64, 'base64');
  await writeFile(path.join(PUBLIC_DIR, 'voiceover.mp3'), audioBuf);

  // Roll character alignment into word timings.
  const chars = data.alignment.characters;
  const starts = data.alignment.character_start_times_seconds;
  const ends = data.alignment.character_end_times_seconds;

  const words = [];
  let curWord = '';
  let curStart = 0;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    if (/\s/.test(c) || c === undefined) {
      if (curWord) {
        words.push({ word: curWord, start_sec: curStart, end_sec: ends[i - 1] ?? curStart + 0.2 });
        curWord = '';
      }
      continue;
    }
    if (!curWord) curStart = starts[i];
    curWord += c;
  }
  if (curWord) {
    words.push({ word: curWord, start_sec: curStart, end_sec: ends[ends.length - 1] });
  }

  // Total audio duration = last end time
  const totalSec = ends[ends.length - 1] ?? 28;

  await writeFile(
    path.join(PUBLIC_DIR, 'voiceover.timings.json'),
    JSON.stringify({ totalSec, words }, null, 2),
  );

  console.log(`✓ voiceover.mp3 (${(audioBuf.length / 1024).toFixed(0)} KB), ${words.length} words, ${totalSec.toFixed(2)}s`);
}

main().catch((e) => { console.error(e); process.exit(1); });