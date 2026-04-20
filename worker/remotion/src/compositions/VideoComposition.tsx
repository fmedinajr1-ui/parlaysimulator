// remotion/src/compositions/VideoComposition.tsx
// The master composition that all three templates reuse. Takes a VideoScript
// and renders beats on a timeline derived from actual audio word timings.

import React from 'react';
import { AbsoluteFill, Audio, Sequence, useVideoConfig } from 'remotion';
import { AvatarLayer } from '../components/AvatarLayer';
import { BrollLayer } from '../components/BrollLayer';
import { CaptionLayer } from '../components/CaptionLayer';
import { LowerThird, StatCard } from '../components/LowerThird';

interface WordTiming {
  word: string;
  start_sec: number;
  end_sec: number;
}

interface Beat {
  index: number;
  vo_text: string;
  duration_est_sec: number;
  visual: 'avatar' | 'avatar_with_lower_third' | 'broll' | 'stat_card';
  on_screen_text?: string;
  stat_card_data?: any;
}

export interface VideoCompositionProps {
  script: {
    hook: { vo_text: string };
    beats: Beat[];
    cta: { vo_text: string; on_screen_text: string };
  };
  audioUrl: string;
  audioTimings: WordTiming[];
  avatarVideoUrl: string;
  brollUrls: string[];
}

// ─── Derive actual beat timings from audio word timings ─────────────────
// Our script uses ESTIMATED durations. Reality is what ElevenLabs actually
// spoke. We map each beat to a word-timing span by counting words in the
// vo_text and walking through the audio timings.

interface BeatSlot {
  startSec: number;
  endSec: number;
  beat: Beat | 'hook' | 'cta';
  beatIndex: number;  // -1 for hook, beats.length for cta
}

function alignBeatsToTimings(
  script: VideoCompositionProps['script'],
  timings: WordTiming[]
): BeatSlot[] {
  const slots: BeatSlot[] = [];
  let wordIdx = 0;

  const segments = [
    { text: script.hook.vo_text, beat: 'hook' as const, index: -1 },
    ...script.beats.map((b, i) => ({ text: b.vo_text, beat: b, index: i })),
    { text: script.cta.vo_text, beat: 'cta' as const, index: script.beats.length },
  ];

  for (const seg of segments) {
    const wordCount = seg.text.split(/\s+/).filter(Boolean).length;
    if (wordCount === 0 || wordIdx >= timings.length) continue;
    const startSec = timings[wordIdx]?.start_sec ?? 0;
    const endWordIdx = Math.min(wordIdx + wordCount - 1, timings.length - 1);
    const endSec = timings[endWordIdx]?.end_sec ?? (startSec + 2);
    slots.push({
      startSec,
      endSec,
      beat: seg.beat,
      beatIndex: seg.index,
    });
    wordIdx = endWordIdx + 1;
  }
  return slots;
}

// ─── Main composition ──────────────────────────────────────────────────

export const VideoComposition: React.FC<VideoCompositionProps> = ({
  script, audioUrl, audioTimings, avatarVideoUrl, brollUrls,
}) => {
  const { fps } = useVideoConfig();
  const slots = alignBeatsToTimings(script, audioTimings);

  return (
    <AbsoluteFill style={{ backgroundColor: '#000' }}>
      {/* Master audio — always full length */}
      {audioUrl && <Audio src={audioUrl} />}

      {slots.map((slot, idx) => {
        const fromFrame = Math.floor(slot.startSec * fps);
        const durFrame = Math.max(6, Math.ceil((slot.endSec - slot.startSec) * fps));

        // Determine visual for this slot
        let visual: Beat['visual'] = 'avatar';
        let onScreenText: string | undefined;
        let statCard: any | undefined;
        let brollUrl: string | undefined;

        if (slot.beat === 'hook') {
          visual = 'avatar_with_lower_third';
          onScreenText = undefined;  // hook uses captions, no sticker
        } else if (slot.beat === 'cta') {
          visual = 'avatar_with_lower_third';
          onScreenText = script.cta.on_screen_text;
        } else {
          visual = slot.beat.visual;
          onScreenText = slot.beat.on_screen_text;
          statCard = slot.beat.stat_card_data;
          if (visual === 'broll') {
            brollUrl = brollUrls[slot.beatIndex] || '';
          }
        }

        return (
          <Sequence key={idx} from={fromFrame} durationInFrames={durFrame}>
            {/* Background layer based on visual type */}
            {visual === 'broll' ? (
              <BrollLayer videoUrl={brollUrl || ''} />
            ) : visual === 'stat_card' && statCard ? (
              <StatCard data={statCard} />
            ) : null}

            {/* Avatar layer — fullscreen for avatar beats, corner for others */}
            <AvatarLayer
              videoUrl={avatarVideoUrl}
              mode={
                visual === 'avatar' || visual === 'avatar_with_lower_third'
                  ? 'fullscreen'
                  : visual === 'broll' ? 'corner'
                  : 'hidden'
              }
            />

            {/* Lower-third sticker for beats with on_screen_text */}
            {visual === 'avatar_with_lower_third' && onScreenText && (
              <LowerThird text={onScreenText} />
            )}
          </Sequence>
        );
      })}

      {/* Captions layer — spans entire video */}
      <CaptionLayer timings={audioTimings} wordsPerGroup={3} />
    </AbsoluteFill>
  );
};
