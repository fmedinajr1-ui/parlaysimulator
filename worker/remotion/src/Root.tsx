// remotion/src/Root.tsx
// Registers all 3 compositions. The render pipeline picks by template name.

import { Composition } from 'remotion';
import { PickReveal } from './compositions/PickReveal';
import { ResultsRecap } from './compositions/ResultsRecap';
import { DataInsight } from './compositions/DataInsight';

// Default props for studio/preview — replaced by real props at render time
const defaultScript: any = {
  id: 'preview',
  target_persona: { display_name: 'The Analyst', key: 'the_analyst' },
  target_duration_sec: 28,
  hook: { vo_text: 'The numbers on Jokic tonight are strange.', visual_style: 'calm_authority' },
  beats: [
    { index: 1, vo_text: 'Beat one text', duration_est_sec: 5, visual: 'avatar_with_lower_third', on_screen_text: 'WATCH' },
    { index: 2, vo_text: 'Beat two text', duration_est_sec: 8, visual: 'stat_card',
      stat_card_data: { title: 'JOKIC L3', rows: [{ label: 'vs MIN', value: '22 PTS', highlight: true }, { label: 'vs MIN', value: '19 PTS' }, { label: 'vs MIN', value: '24 PTS' }], footer: 'Line: 27.5' } },
    { index: 3, vo_text: 'Beat three text', duration_est_sec: 7, visual: 'avatar' },
    { index: 4, vo_text: 'Beat four text', duration_est_sec: 3.5, visual: 'broll' },
  ],
  cta: { vo_text: 'Full breakdown in the bio.', on_screen_text: '→ LINK IN BIO' },
};

const defaultPreviewProps = {
  script: defaultScript,
  audioUrl: '',
  audioTimings: [],
  avatarVideoUrl: '',
  brollUrls: ['', '', '', ''],
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="PickReveal"
        component={PickReveal as any}
        durationInFrames={30 * 30}  // 30 sec at 30fps — updated per render via calculateMetadata
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultPreviewProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(22, Math.min(38, (props as any).script.target_duration_sec)) * 30,
        })}
      />
      <Composition
        id="ResultsRecap"
        component={ResultsRecap as any}
        durationInFrames={30 * 30}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultPreviewProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(22, Math.min(38, (props as any).script.target_duration_sec)) * 30,
        })}
      />
      <Composition
        id="DataInsight"
        component={DataInsight as any}
        durationInFrames={30 * 30}
        fps={30}
        width={1080}
        height={1920}
        defaultProps={defaultPreviewProps}
        calculateMetadata={({ props }) => ({
          durationInFrames: Math.max(22, Math.min(38, (props as any).script.target_duration_sec)) * 30,
        })}
      />
    </>
  );
};
