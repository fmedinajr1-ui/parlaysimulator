import React from 'react';
import { AbsoluteFill, Audio, Sequence, useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { loadFont as loadInter } from '@remotion/google-fonts/Inter';
import { loadFont as loadSpaceGrotesk } from '@remotion/google-fonts/SpaceGrotesk';
import { Scene1DropZone } from './scenes/Scene1_DropZone';
import { Scene2EngineFanout } from './scenes/Scene2_EngineFanout';
import { Scene3OverUnderCall } from './scenes/Scene3_OverUnderCall';
import { Scene4SwapSuggestion } from './scenes/Scene4_SwapSuggestion';
import { Scene5BroadcastCTA } from './scenes/Scene5_BroadcastCTA';
import { CaptionLayer } from './components/CaptionLayer';

loadInter('normal', { weights: ['400', '500', '600', '700', '800'], subsets: ['latin'] });
loadSpaceGrotesk('normal', { weights: ['500', '600', '700'], subsets: ['latin'] });

interface WordTiming { word: string; start_sec: number; end_sec: number; }
interface Props { audioUrl: string; timings: WordTiming[]; }

/**
 * The 5 sentences in the script map 1:1 to scenes. We slice the word
 * timings array by sentence-ending punctuation in the original script.
 */
const SENTENCE_WORD_COUNTS = [7, 24, 23, 12, 9]; // matches generate-voiceover.mjs SCRIPT

function deriveSlots(timings: WordTiming[]) {
  const slots: { startSec: number; endSec: number }[] = [];
  let idx = 0;
  for (const count of SENTENCE_WORD_COUNTS) {
    const start = timings[idx]?.start_sec ?? 0;
    const endIdx = Math.min(idx + count - 1, timings.length - 1);
    const end = timings[endIdx]?.end_sec ?? start + 5;
    slots.push({ startSec: start, endSec: end });
    idx = endIdx + 1;
  }
  return slots;
}

const PersistentBg: React.FC = () => {
  const frame = useCurrentFrame();
  // Slow drift on the radial center to add subtle life
  const cx = interpolate(frame, [0, 900], [42, 58], { extrapolateRight: 'clamp' });
  const cy = interpolate(frame, [0, 900], [38, 62], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill
      style={{
        background: `radial-gradient(circle at ${cx}% ${cy}%, #102032 0%, #080d18 55%, #03060c 100%)`,
      }}
    />
  );
};

export const MainVideo: React.FC<Props> = ({ audioUrl, timings }) => {
  const { fps } = useVideoConfig();
  const slots = deriveSlots(timings);
  const SceneComponents = [
    Scene1DropZone,
    Scene2EngineFanout,
    Scene3OverUnderCall,
    Scene4SwapSuggestion,
    Scene5BroadcastCTA,
  ];

  return (
    <AbsoluteFill style={{ backgroundColor: '#03060c', fontFamily: 'Inter, sans-serif' }}>
      <PersistentBg />
      {audioUrl && <Audio src={audioUrl} />}

      {slots.map((slot, i) => {
        const Comp = SceneComponents[i];
        const fromFrame = Math.floor(slot.startSec * fps);
        // Scene runs from its start until the next scene starts (or end of audio + tail).
        const nextStart = slots[i + 1]?.startSec ?? slot.endSec + 1.0;
        const durFrame = Math.max(15, Math.ceil((nextStart - slot.startSec) * fps));
        return (
          <Sequence key={i} from={fromFrame} durationInFrames={durFrame}>
            <Comp />
          </Sequence>
        );
      })}

      {/* Captions across the whole video */}
      <CaptionLayer timings={timings} />
    </AbsoluteFill>
  );
};