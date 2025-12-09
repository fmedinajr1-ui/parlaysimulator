import { FatigueDifferentialBadge } from './FatigueDifferentialBadge';
import { extractTeamsFromDescription } from '@/hooks/useFatigueData';

interface FatigueDifferentialWrapperProps {
  description: string;
  compact?: boolean;
}

export function FatigueDifferentialWrapper({ description, compact = false }: FatigueDifferentialWrapperProps) {
  const teams = extractTeamsFromDescription(description);
  
  if (!teams) {
    return null;
  }
  
  return (
    <FatigueDifferentialBadge 
      homeTeam={teams.team2} 
      awayTeam={teams.team1}
      compact={compact}
    />
  );
}
