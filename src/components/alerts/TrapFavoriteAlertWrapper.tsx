import { TrapFavoriteAlert } from './TrapFavoriteAlert';
import { extractTeamsFromDescription } from '@/hooks/useFatigueData';

interface TrapFavoriteAlertWrapperProps {
  description: string;
  sport: 'NBA' | 'NFL';
  className?: string;
}

export function TrapFavoriteAlertWrapper({ description, sport, className }: TrapFavoriteAlertWrapperProps) {
  const teams = extractTeamsFromDescription(description);
  
  if (!teams) {
    return null;
  }
  
  return (
    <TrapFavoriteAlert
      favoriteTeam={teams.team2}
      underdogTeam={teams.team1}
      sport={sport}
      className={className}
    />
  );
}
