import React from 'react';
import { WarRoomLayout } from './warroom/WarRoomLayout';
import type { ScoutGameContext } from '@/pages/Scout';

interface CustomerScoutViewProps {
  gameContext: ScoutGameContext;
  isDemo?: boolean;
  adminEventId?: string;
  onGameChange?: (game: { eventId: string; homeTeam: string; awayTeam: string; gameDescription: string }) => void;
}

export function CustomerScoutView({ gameContext, isDemo = false, adminEventId, onGameChange }: CustomerScoutViewProps) {
  return (
    <WarRoomLayout
      gameContext={gameContext}
      isDemo={isDemo}
      adminEventId={adminEventId}
      onGameChange={onGameChange}
    />
  );
}
