import React from 'react';
import { WarRoomLayout } from './warroom/WarRoomLayout';
import type { ScoutGameContext } from '@/pages/Scout';

interface CustomerScoutViewProps {
  gameContext: ScoutGameContext;
  isDemo?: boolean;
}

export function CustomerScoutView({ gameContext, isDemo = false }: CustomerScoutViewProps) {
  return <WarRoomLayout gameContext={gameContext} isDemo={isDemo} />;
}
