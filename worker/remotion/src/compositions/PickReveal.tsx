// remotion/src/compositions/PickReveal.tsx
// Pick-reveal template — high energy, emphasizes the stat_card moment.
// Currently delegates entirely to VideoComposition; template-specific tweaks
// can be added here later (e.g. intro sting, specific color palette).

import React from 'react';
import { VideoComposition, VideoCompositionProps } from './VideoComposition';

export const PickReveal: React.FC<VideoCompositionProps> = (props) => {
  return <VideoComposition {...props} />;
};
