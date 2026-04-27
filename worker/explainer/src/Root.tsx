import React from 'react';
import { Composition, staticFile } from 'remotion';
import { MainVideo } from './MainVideo';
import timings from '../public/voiceover.timings.json';

const fps = 30;

// Total duration is driven by the actual voiceover length (with a small tail).
const TOTAL_SEC = (timings as any).totalSec + 1.2;

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="explainer"
      component={MainVideo as any}
      durationInFrames={Math.ceil(TOTAL_SEC * fps)}
      fps={fps}
      width={1080}
      height={1920}
      defaultProps={{
        audioUrl: staticFile('voiceover.mp3'),
        timings: (timings as any).words,
      }}
    />
  );
};