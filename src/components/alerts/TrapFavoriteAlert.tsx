import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingDown, Trophy, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrapFavoriteAlertProps {
  favoriteTeam: string;
  underdogTeam: string;
  sport: 'NBA' | 'NFL';
  favoriteOdds?: number;
  className?: string;
}

interface TeamStanding {
  team_name: string;
  wins: number;
  losses: number;
  win_pct: number;
  streak: string | null;
  last_10: string | null;
}

export function TrapFavoriteAlert({
  favoriteTeam,
  underdogTeam,
  sport,
  favoriteOdds,
  className
}: TrapFavoriteAlertProps) {
  const [favoriteStanding, setFavoriteStanding] = useState<TeamStanding | null>(null);
  const [underdogStanding, setUnderdogStanding] = useState<TeamStanding | null>(null);
  const [loading, setLoading] = useState(true);
  const [isTrap, setIsTrap] = useState(false);

  useEffect(() => {
    async function fetchStandings() {
      try {
        // Fetch standings for both teams
        const { data: standings } = await supabase
          .from('team_season_standings')
          .select('team_name, wins, losses, win_pct, streak, last_10')
          .eq('sport', sport)
          .in('team_name', [favoriteTeam, underdogTeam]);

        if (standings && standings.length >= 2) {
          const favorite = standings.find(s => 
            s.team_name.toLowerCase().includes(favoriteTeam.toLowerCase()) ||
            favoriteTeam.toLowerCase().includes(s.team_name.toLowerCase())
          );
          const underdog = standings.find(s => 
            s.team_name.toLowerCase().includes(underdogTeam.toLowerCase()) ||
            underdogTeam.toLowerCase().includes(s.team_name.toLowerCase())
          );

          if (favorite && underdog) {
            setFavoriteStanding(favorite as TeamStanding);
            setUnderdogStanding(underdog as TeamStanding);
            
            // Detect trap: favorite has worse record than underdog
            setIsTrap(favorite.win_pct < underdog.win_pct);
          }
        }
      } catch (error) {
        console.error('Error fetching standings:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchStandings();
  }, [favoriteTeam, underdogTeam, sport]);

  if (loading || !favoriteStanding || !underdogStanding) {
    return null;
  }

  if (!isTrap) {
    return null; // Don't show anything if it's not a trap situation
  }

  const recordDiff = Math.round((underdogStanding.win_pct - favoriteStanding.win_pct) * 100);

  return (
    <div className={cn(
      "p-3 rounded-lg border bg-red-500/10 border-red-500/30",
      className
    )}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-red-400">TRAP FAVORITE DETECTED</span>
            <Badge variant="outline" className="text-xs bg-red-500/20 text-red-400 border-red-500/30">
              <TrendingDown className="w-3 h-3 mr-1" />
              -{recordDiff}% record gap
            </Badge>
          </div>
          
          <p className="text-xs text-muted-foreground">
            The favorite has a <strong className="text-red-400">worse record</strong> than the underdog
          </p>

          <div className="grid grid-cols-2 gap-2 text-xs">
            {/* Favorite */}
            <div className="p-2 rounded bg-muted/30 border border-red-500/20">
              <div className="flex items-center gap-1 mb-1">
                <TrendingDown className="w-3 h-3 text-red-400" />
                <span className="text-muted-foreground">Favorite</span>
                {favoriteOdds && (
                  <Badge variant="outline" className="text-xs ml-auto">
                    {favoriteOdds > 0 ? `+${favoriteOdds}` : favoriteOdds}
                  </Badge>
                )}
              </div>
              <p className="font-medium text-foreground truncate">{favoriteTeam}</p>
              <p className="text-red-400 font-bold">
                {favoriteStanding.wins}-{favoriteStanding.losses} ({Math.round(favoriteStanding.win_pct * 100)}%)
              </p>
              {favoriteStanding.streak && (
                <p className="text-muted-foreground">{favoriteStanding.streak}</p>
              )}
            </div>

            {/* Underdog */}
            <div className="p-2 rounded bg-muted/30 border border-emerald-500/20">
              <div className="flex items-center gap-1 mb-1">
                <Trophy className="w-3 h-3 text-emerald-400" />
                <span className="text-muted-foreground">Underdog</span>
              </div>
              <p className="font-medium text-foreground truncate">{underdogTeam}</p>
              <p className="text-emerald-400 font-bold">
                {underdogStanding.wins}-{underdogStanding.losses} ({Math.round(underdogStanding.win_pct * 100)}%)
              </p>
              {underdogStanding.streak && (
                <p className="text-muted-foreground">{underdogStanding.streak}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Shield className="w-3 h-3 text-yellow-400" />
            <span className="text-xs text-yellow-400">
              Consider fading the favorite or taking the underdog ML
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
