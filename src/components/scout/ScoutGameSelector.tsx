import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { Calendar, Clock, Users, ChevronRight, RefreshCw, Database } from "lucide-react";
import type { GameContext, InjuryStatus, RosterPlayer } from "@/pages/Scout";
import { toZonedTime, format } from "date-fns-tz";
import { toast } from "sonner";
import { 
  calculatePreGameBaseline, 
  type PreGameBaseline, 
  type TeamFatigueData, 
  type PlayerSeasonStats 
} from "@/types/pre-game-baselines";

// Normalize player names for fuzzy matching (handles diacritics and suffixes)
const normalizePlayerName = (name: string): string => {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics (Şengün → Sengun)
    .replace(/\s+(Jr\.?|Sr\.?|III|II|IV)$/i, '') // Remove suffixes
    .toLowerCase()
    .trim();
};

// Find best ESPN match for a player name
const findESPNMatch = (
  playerName: string, 
  espnJerseys: Map<string, { jersey: string; position: string }>
): { jersey: string; position: string } | null => {
  // Exact match first
  if (espnJerseys.has(playerName)) {
    return espnJerseys.get(playerName)!;
  }
  
  // Normalized match
  const normalizedTarget = normalizePlayerName(playerName);
  for (const [espnName, data] of espnJerseys.entries()) {
    if (normalizePlayerName(espnName) === normalizedTarget) {
      return data;
    }
  }
  
  // Partial last name match (for unique last names)
  const targetLastName = normalizedTarget.split(' ').pop();
  if (targetLastName && targetLastName.length > 4) {
    for (const [espnName, data] of espnJerseys.entries()) {
      const espnLastName = normalizePlayerName(espnName).split(' ').pop();
      if (targetLastName === espnLastName) {
        return data;
      }
    }
  }
  
  return null;
};

const CACHE_KEY = 'scout_props_last_refresh';
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes

interface ScoutGameSelectorProps {
  selectedGame: GameContext | null;
  onGameSelect: (game: GameContext) => void;
}

interface TodaysGame {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  gameDescription: string;
}

export function ScoutGameSelector({ selectedGame, onGameSelect }: ScoutGameSelectorProps) {
  const [games, setGames] = useState<TodaysGame[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingRoster, setLoadingRoster] = useState<string | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshAttempted, setRefreshAttempted] = useState(false);
  const [isRefreshingRoster, setIsRefreshingRoster] = useState(false);
  const [isBulkSyncing, setIsBulkSyncing] = useState(false);

  // Bulk sync all NBA jerseys from ESPN
  const handleBulkSyncJerseys = async () => {
    setIsBulkSyncing(true);
    try {
      console.log('[ScoutGameSelector] Starting bulk jersey sync for all NBA teams...');
      toast.info('Starting bulk sync for all 30 NBA teams...');
      
      const { data, error } = await supabase.functions.invoke('bulk-sync-jerseys', {});
      
      if (error) throw error;
      
      console.log('[ScoutGameSelector] Bulk sync result:', data);
      toast.success(`Updated ${data?.updated || 0} players. ${data?.stillMissing || 0} still missing jerseys.`);
      
      // Reload current game if selected
      if (selectedGame) {
        const gameToReload: TodaysGame = {
          eventId: selectedGame.eventId,
          homeTeam: selectedGame.homeTeam,
          awayTeam: selectedGame.awayTeam,
          commenceTime: selectedGame.commenceTime,
          gameDescription: selectedGame.gameDescription,
        };
        await loadRosters(gameToReload);
      }
    } catch (err) {
      console.error('[ScoutGameSelector] Bulk sync error:', err);
      toast.error('Failed to sync jerseys');
    } finally {
      setIsBulkSyncing(false);
    }
  };

  // Manual refresh roster data for current game
  const handleRefreshRoster = async () => {
    if (!selectedGame) return;
    
    setIsRefreshingRoster(true);
    try {
      console.log('[ScoutGameSelector] Manual roster refresh for:', selectedGame.homeTeam, 'vs', selectedGame.awayTeam);
      
      const { data, error } = await supabase.functions.invoke('sync-missing-rosters', {
        body: { 
          teams: [selectedGame.homeTeam, selectedGame.awayTeam],
          force_espn: true
        }
      });
      
      if (error) throw error;
      
      console.log('[ScoutGameSelector] Roster sync result:', data);
      
      // Re-load the rosters after sync
      const gameToReload: TodaysGame = {
        eventId: selectedGame.eventId,
        homeTeam: selectedGame.homeTeam,
        awayTeam: selectedGame.awayTeam,
        commenceTime: selectedGame.commenceTime,
        gameDescription: selectedGame.gameDescription,
      };
      await loadRosters(gameToReload);
      
      toast.success(`Updated roster data for ${data?.synced || 0} players`);
    } catch (err) {
      console.error('[ScoutGameSelector] Roster refresh error:', err);
      toast.error('Failed to refresh roster data');
    } finally {
      setIsRefreshingRoster(false);
    }
  };

  const shouldAutoRefresh = (): boolean => {
    const lastRefresh = localStorage.getItem(CACHE_KEY);
    if (!lastRefresh) return true;
    
    const lastRefreshTime = parseInt(lastRefresh, 10);
    const timeSinceRefresh = Date.now() - lastRefreshTime;
    
    return timeSinceRefresh > CACHE_DURATION_MS;
  };

  const triggerAutoRefresh = async () => {
    if (!shouldAutoRefresh()) {
      console.log('[ScoutGameSelector] Skipping refresh - recently refreshed');
      setRefreshAttempted(true);
      return;
    }
    
    setIsRefreshing(true);
    try {
      console.log('[ScoutGameSelector] Triggering auto-refresh with force_clear...');
      const { data, error } = await supabase.functions.invoke('refresh-todays-props', {
        body: { sport: 'basketball_nba', use_bdl_fallback: true, force_clear: true }
      });
      
      if (error) {
        console.error('[ScoutGameSelector] Refresh error:', error);
      } else if (data?.success) {
        console.log('[ScoutGameSelector] Refresh successful:', data);
        localStorage.setItem(CACHE_KEY, Date.now().toString());
        await fetchTodaysGames();
      }
    } catch (err) {
      console.error('[ScoutGameSelector] Auto-refresh error:', err);
    } finally {
      setIsRefreshing(false);
      setRefreshAttempted(true);
    }
  };

  useEffect(() => {
    const loadGames = async () => {
      const gamesFound = await fetchTodaysGames();
      
      if (gamesFound === 0 && !refreshAttempted) {
        await triggerAutoRefresh();
      }
    };
    
    loadGames();
  }, []);

  const fetchTodaysGames = async (): Promise<number> => {
    try {
      const now = new Date();
      const easternTimeZone = 'America/New_York';
      const easternNow = toZonedTime(now, easternTimeZone);
      
      const queryStartET = new Date(easternNow);
      queryStartET.setHours(5, 0, 0, 0);
      
      const queryEndET = new Date(easternNow);
      queryEndET.setDate(queryEndET.getDate() + 1);
      queryEndET.setHours(5, 0, 0, 0);

      const etOffset = -5;
      const startUTC = new Date(queryStartET.getTime() - etOffset * 60 * 60 * 1000);
      const endUTC = new Date(queryEndET.getTime() - etOffset * 60 * 60 * 1000);
      
      console.log('[ScoutGameSelector] Query range:', {
        startUTC: startUTC.toISOString(),
        endUTC: endUTC.toISOString()
      });

      const { data, error } = await supabase
        .from('unified_props')
        .select('event_id, game_description, commence_time')
        .eq('sport', 'basketball_nba')
        .gte('commence_time', startUTC.toISOString())
        .lt('commence_time', endUTC.toISOString())
        .order('commence_time', { ascending: true });

      if (error) throw error;

      const uniqueGames = new Map<string, TodaysGame>();
      for (const prop of data || []) {
        if (!uniqueGames.has(prop.event_id)) {
          const parts = prop.game_description?.split(' @ ') || [];
          uniqueGames.set(prop.event_id, {
            eventId: prop.event_id,
            homeTeam: parts[1] || 'Unknown',
            awayTeam: parts[0] || 'Unknown',
            commenceTime: prop.commence_time,
            gameDescription: prop.game_description || '',
          });
        }
      }

      const gamesList = Array.from(uniqueGames.values());
      setGames(gamesList);
      return gamesList.length;
    } catch (err) {
      console.error('Error fetching games:', err);
      return 0;
    } finally {
      setIsLoading(false);
    }
  };

  const loadRosters = async (game: TodaysGame) => {
    setLoadingRoster(game.eventId);
    
    try {
      // Fetch only ACTIVE players from bdl_player_cache (current season only)
      const { data: homeRoster, error: homeError } = await supabase
        .from('bdl_player_cache')
        .select('player_name, jersey_number, position')
        .ilike('team_name', `%${game.homeTeam.replace(/\s+/g, '%')}%`)
        .eq('is_active', true)
        .order('player_name');

      const { data: awayRoster, error: awayError } = await supabase
        .from('bdl_player_cache')
        .select('player_name, jersey_number, position')
        .ilike('team_name', `%${game.awayTeam.replace(/\s+/g, '%')}%`)
        .eq('is_active', true)
        .order('player_name');

      if (homeError) console.warn('Home roster error:', homeError);
      if (awayError) console.warn('Away roster error:', awayError);

      // Fetch real prop lines from unified_props for this game
      const { data: propsData, error: propsError } = await supabase
        .from('unified_props')
        .select('player_name, prop_type, current_line, over_price, under_price, bookmaker')
        .eq('event_id', game.eventId)
        .eq('is_active', true)
        .in('prop_type', ['points', 'rebounds', 'assists']);

      if (propsError) console.warn('Props fetch error:', propsError);
      
      // Map prop lines
      const propLines = (propsData || []).map(p => ({
        playerName: p.player_name,
        propType: p.prop_type as 'points' | 'rebounds' | 'assists',
        line: Number(p.current_line),
        overPrice: p.over_price ? Number(p.over_price) : undefined,
        underPrice: p.under_price ? Number(p.under_price) : undefined,
        bookmaker: p.bookmaker || undefined,
      }));

      console.log(`[ScoutGameSelector] Fetched ${propLines.length} real prop lines for game ${game.eventId}`);

      // Fetch team fatigue scores
      const { data: homeFatigueData } = await supabase
        .from('nba_fatigue_scores')
        .select('team_name, fatigue_score, fatigue_category, is_back_to_back, is_road_back_to_back, is_three_in_four, is_four_in_six, travel_miles')
        .ilike('team_name', `%${game.homeTeam.replace(/\s+/g, '%')}%`)
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      const { data: awayFatigueData } = await supabase
        .from('nba_fatigue_scores')
        .select('team_name, fatigue_score, fatigue_category, is_back_to_back, is_road_back_to_back, is_three_in_four, is_four_in_six, travel_miles')
        .ilike('team_name', `%${game.awayTeam.replace(/\s+/g, '%')}%`)
        .order('game_date', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Map team fatigue
      const homeTeamFatigue: TeamFatigueData | undefined = homeFatigueData ? {
        teamName: homeFatigueData.team_name,
        fatigueScore: homeFatigueData.fatigue_score ?? 10,
        fatigueCategory: homeFatigueData.fatigue_category ?? 'fresh',
        isBackToBack: homeFatigueData.is_back_to_back ?? false,
        isRoadB2B: homeFatigueData.is_road_back_to_back ?? false,
        isThreeInFour: homeFatigueData.is_three_in_four ?? false,
        isFourInSix: homeFatigueData.is_four_in_six ?? false,
        travelMiles: homeFatigueData.travel_miles ? Number(homeFatigueData.travel_miles) : null,
      } : undefined;

      const awayTeamFatigue: TeamFatigueData | undefined = awayFatigueData ? {
        teamName: awayFatigueData.team_name,
        fatigueScore: awayFatigueData.fatigue_score ?? 10,
        fatigueCategory: awayFatigueData.fatigue_category ?? 'fresh',
        isBackToBack: awayFatigueData.is_back_to_back ?? false,
        isRoadB2B: awayFatigueData.is_road_back_to_back ?? false,
        isThreeInFour: awayFatigueData.is_three_in_four ?? false,
        isFourInSix: awayFatigueData.is_four_in_six ?? false,
        travelMiles: awayFatigueData.travel_miles ? Number(awayFatigueData.travel_miles) : null,
      } : undefined;

      console.log(`[ScoutGameSelector] Team fatigue - Home: ${homeTeamFatigue?.fatigueScore ?? 'N/A'}, Away: ${awayTeamFatigue?.fatigueScore ?? 'N/A'}`);

      // Include ALL players - mark missing jerseys with "?" instead of filtering out
      let validHomeRoster: RosterPlayer[] = (homeRoster || []).map(p => {
        const hasValidJersey = p.jersey_number && 
          p.jersey_number !== '?' && 
          p.jersey_number !== 'null' && 
          p.jersey_number !== 'NULL' &&
          p.jersey_number.trim() !== '';
        return {
          name: p.player_name,
          jersey: hasValidJersey ? p.jersey_number : '?',
          position: p.position || '',
        };
      });

      let validAwayRoster: RosterPlayer[] = (awayRoster || []).map(p => {
        const hasValidJersey = p.jersey_number && 
          p.jersey_number !== '?' && 
          p.jersey_number !== 'null' && 
          p.jersey_number !== 'NULL' &&
          p.jersey_number.trim() !== '';
        return {
          name: p.player_name,
          jersey: hasValidJersey ? p.jersey_number : '?',
          position: p.position || '',
        };
      });

      // Track players with missing jersey data
      const playersWithMissingJerseys = [...validHomeRoster, ...validAwayRoster].filter(p => p.jersey === '?');

      // Check for players with missing jersey data and trigger background sync
      if (playersWithMissingJerseys.length > 0) {
        console.log(`[ScoutGameSelector] ${playersWithMissingJerseys.length} players missing jersey data, triggering sync`);
        
        // Trigger background sync (don't await)
        supabase.functions.invoke('sync-missing-rosters', {
          body: { teams: [game.homeTeam, game.awayTeam] }
        }).then(result => {
          console.log('[ScoutGameSelector] Roster sync triggered:', result.data);
        }).catch(err => {
          console.warn('[ScoutGameSelector] Roster sync failed:', err);
        });
      }

      // FALLBACK: If roster cache is completely empty, use players from props data
      if (validHomeRoster.length === 0 && validAwayRoster.length === 0 && propsData && propsData.length > 0) {
        console.warn('[ScoutGameSelector] No roster data in cache, using props players as fallback');

        // Extract unique player names from props
        const uniquePlayerNames = [...new Set(propsData.map(p => p.player_name))];
        
        // Create fallback roster entries (no jersey numbers - will show "?" in UI)
        const fallbackRoster: RosterPlayer[] = uniquePlayerNames.map(name => ({
          name,
          jersey: '?',
          position: '',
        }));

        // Split players between teams based on game description
        validHomeRoster = fallbackRoster.slice(0, Math.ceil(fallbackRoster.length / 2));
        validAwayRoster = fallbackRoster.slice(Math.ceil(fallbackRoster.length / 2));
        
        console.log(`[ScoutGameSelector] Created fallback rosters from ${uniquePlayerNames.length} prop players`);
      }

      // Fetch player season stats for all roster players
      const allPlayerNames = [...validHomeRoster, ...validAwayRoster].map(p => p.name);
      
      const { data: playerStatsData } = await supabase
        .from('player_season_stats')
        .select('player_name, avg_minutes, avg_points, avg_rebounds, avg_assists, consistency_score, trend_direction, last_10_avg_points, b2b_avg_points, rest_avg_points')
        .in('player_name', allPlayerNames);

      // Map player stats
      const playerStatsMap = new Map<string, PlayerSeasonStats>();
      (playerStatsData || []).forEach(ps => {
        playerStatsMap.set(ps.player_name, {
          playerName: ps.player_name,
          avgMinutes: Number(ps.avg_minutes) || 25,
          avgPoints: Number(ps.avg_points) || 0,
          avgRebounds: Number(ps.avg_rebounds) || 0,
          avgAssists: Number(ps.avg_assists) || 0,
          consistencyScore: Number(ps.consistency_score) || 65,
          trendDirection: (ps.trend_direction as 'hot' | 'cold' | 'stable') || 'stable',
          last10AvgPoints: ps.last_10_avg_points ? Number(ps.last_10_avg_points) : null,
          b2bAvgPoints: ps.b2b_avg_points ? Number(ps.b2b_avg_points) : null,
          restAvgPoints: ps.rest_avg_points ? Number(ps.rest_avg_points) : null,
        });
      });

      console.log(`[ScoutGameSelector] Fetched stats for ${playerStatsMap.size} players`);

      // Calculate pre-game baselines for each player
      const preGameBaselines: PreGameBaseline[] = [];
      
      validHomeRoster.forEach(p => {
        const stats = playerStatsMap.get(p.name) || null;
        preGameBaselines.push(calculatePreGameBaseline(p.name, stats, homeTeamFatigue || null));
      });
      
      validAwayRoster.forEach(p => {
        const stats = playerStatsMap.get(p.name) || null;
        preGameBaselines.push(calculatePreGameBaseline(p.name, stats, awayTeamFatigue || null));
      });

      console.log(`[ScoutGameSelector] Calculated ${preGameBaselines.length} pre-game baselines`);
      console.log(`[ScoutGameSelector] Loaded rosters - Home: ${validHomeRoster.length} players, Away: ${validAwayRoster.length} players`);

      // Fetch ESPN event ID for live PBP data
      let espnEventId: string | undefined;
      try {
        const { data: espnData, error: espnError } = await supabase.functions.invoke('get-espn-event-id', {
          body: { homeTeam: game.homeTeam, awayTeam: game.awayTeam }
        });
        
        if (!espnError && espnData?.espnEventId) {
          espnEventId = espnData.espnEventId;
          console.log(`[ScoutGameSelector] Resolved ESPN event ID: ${espnEventId}`);
          
          // Fetch ESPN summary to get live rosters with jersey numbers
          try {
            const espnResponse = await fetch(
              `https://site.api.espn.com/apis/site/v2/sports/basketball/nba/summary?event=${espnEventId}`
            );
            
            if (espnResponse.ok) {
              const espnSummary = await espnResponse.json();
              const rosters = espnSummary.boxscore?.players || [];
              const espnJerseys = new Map<string, { jersey: string; position: string }>();
              
              for (const team of rosters) {
                for (const athlete of team.statistics?.[0]?.athletes || []) {
                  const displayName = athlete.athlete?.displayName;
                  if (displayName) {
                    espnJerseys.set(displayName, {
                      jersey: athlete.athlete?.jersey || '?',
                      position: athlete.athlete?.position?.abbreviation || '',
                    });
                  }
                }
              }
              
              console.log(`[ScoutGameSelector] ESPN provided jersey data for ${espnJerseys.size} players`);
              
              // Extract injury data from ESPN summary
              const injuryMap = new Map<string, { status: InjuryStatus; detail: string }>();
              const gameInfo = espnSummary.gameInfo;
              
              // Check for injuries in gameInfo.injuries array
              if (gameInfo?.injuries && Array.isArray(gameInfo.injuries)) {
                for (const teamInjuries of gameInfo.injuries) {
                  for (const injury of teamInjuries.injuries || []) {
                    const athleteName = injury.athlete?.displayName;
                    const rawStatus = (injury.status || injury.type?.description || '').toUpperCase();
                    
                    if (athleteName && rawStatus) {
                      // Map ESPN status to our InjuryStatus type
                      let status: InjuryStatus = null;
                      if (rawStatus.includes('OUT')) status = 'OUT';
                      else if (rawStatus.includes('DOUBTFUL')) status = 'DOUBTFUL';
                      else if (rawStatus.includes('QUESTIONABLE')) status = 'QUESTIONABLE';
                      else if (rawStatus.includes('DAY') || rawStatus.includes('DTD')) status = 'DTD';
                      else if (rawStatus.includes('GAME TIME') || rawStatus.includes('GTD')) status = 'GTD';
                      
                      if (status) {
                        injuryMap.set(normalizePlayerName(athleteName), {
                          status,
                          detail: injury.details?.detail || injury.longComment || ''
                        });
                      }
                    }
                  }
                }
              }
              
              // Also check header.competitions for injury info
              const competition = espnSummary.header?.competitions?.[0];
              if (competition?.competitors) {
                for (const competitor of competition.competitors) {
                  for (const player of competitor.leaders?.[0]?.leaders || []) {
                    // Check athlete injury status
                    const athleteInjury = player.athlete?.injuries?.[0];
                    if (athleteInjury) {
                      const rawStatus = (athleteInjury.status || '').toUpperCase();
                      let status: InjuryStatus = null;
                      if (rawStatus.includes('OUT')) status = 'OUT';
                      else if (rawStatus.includes('DOUBTFUL')) status = 'DOUBTFUL';
                      else if (rawStatus.includes('QUESTIONABLE')) status = 'QUESTIONABLE';
                      else if (rawStatus.includes('DAY') || rawStatus.includes('DTD')) status = 'DTD';
                      else if (rawStatus.includes('GAME TIME') || rawStatus.includes('GTD')) status = 'GTD';
                      
                      if (status && player.athlete?.displayName) {
                        injuryMap.set(normalizePlayerName(player.athlete.displayName), {
                          status,
                          detail: athleteInjury.longComment || ''
                        });
                      }
                    }
                  }
                }
              }
              
              console.log(`[ScoutGameSelector] ESPN provided injury data for ${injuryMap.size} players`);
              
              // Fill in missing jerseys from ESPN data with fuzzy matching
              const playersToUpdate: Array<{ name: string; jersey: string }> = [];
              
              // Apply jersey updates and injury status
              validHomeRoster = validHomeRoster.map(p => {
                const normalizedName = normalizePlayerName(p.name);
                const injury = injuryMap.get(normalizedName);
                
                if (p.jersey === '?') {
                  const match = findESPNMatch(p.name, espnJerseys);
                  if (match && match.jersey && match.jersey !== '?') {
                    playersToUpdate.push({ name: p.name, jersey: match.jersey });
                    return { 
                      ...p, 
                      jersey: match.jersey,
                      injuryStatus: injury?.status,
                      injuryDetail: injury?.detail 
                    };
                  }
                }
                return { 
                  ...p, 
                  injuryStatus: injury?.status,
                  injuryDetail: injury?.detail 
                };
              });
              
              validAwayRoster = validAwayRoster.map(p => {
                const normalizedName = normalizePlayerName(p.name);
                const injury = injuryMap.get(normalizedName);
                
                if (p.jersey === '?') {
                  const match = findESPNMatch(p.name, espnJerseys);
                  if (match && match.jersey && match.jersey !== '?') {
                    playersToUpdate.push({ name: p.name, jersey: match.jersey });
                    return { 
                      ...p, 
                      jersey: match.jersey,
                      injuryStatus: injury?.status,
                      injuryDetail: injury?.detail 
                    };
                  }
                }
                return { 
                  ...p, 
                  injuryStatus: injury?.status,
                  injuryDetail: injury?.detail 
                };
              });
              
              // Update cache with ESPN jersey data (background, don't await)
              if (playersToUpdate.length > 0) {
                console.log(`[ScoutGameSelector] Updating ${playersToUpdate.length} jersey numbers from ESPN`);
                for (const player of playersToUpdate) {
                  supabase.from('bdl_player_cache')
                    .update({ jersey_number: player.jersey, last_updated: new Date().toISOString() })
                    .eq('player_name', player.name)
                    .then(({ error }) => {
                      if (error) console.warn(`[ScoutGameSelector] Cache update failed for ${player.name}:`, error);
                    });
                }
              }
            }
          } catch (espnSummaryErr) {
            console.warn('[ScoutGameSelector] ESPN summary fetch failed:', espnSummaryErr);
          }
        } else {
          console.warn('[ScoutGameSelector] Could not resolve ESPN event ID:', espnError || 'No match');
        }
      } catch (espnErr) {
        console.warn('[ScoutGameSelector] ESPN lookup failed:', espnErr);
      }

      const gameContext: GameContext = {
        ...game,
        espnEventId,
        homeRoster: validHomeRoster,
        awayRoster: validAwayRoster,
        propLines: propLines,
        preGameBaselines,
        homeTeamFatigue,
        awayTeamFatigue,
      };

      onGameSelect(gameContext);
    } catch (err) {
      console.error('Error loading rosters:', err);
      onGameSelect({
        ...game,
        homeRoster: [],
        awayRoster: [],
        propLines: [],
      });
    } finally {
      setLoadingRoster(null);
    }
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    const easternDate = toZonedTime(date, 'America/New_York');
    return format(easternDate, 'h:mm a', { timeZone: 'America/New_York' });
  };

  const getGameStatus = (commenceTime: string) => {
    const now = new Date();
    const gameTime = new Date(commenceTime);
    const diffMs = gameTime.getTime() - now.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < -120) return { label: '2H Available', variant: 'default' as const };
    if (diffMins < 0) return { label: 'In Progress', variant: 'secondary' as const };
    if (diffMins < 60) return { label: `${diffMins}m`, variant: 'outline' as const };
    return { label: formatTime(commenceTime), variant: 'outline' as const };
  };

  if (isLoading) {
    return (
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Calendar className="w-4 h-4 text-primary" />
            Today's Games
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (games.length === 0) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-8 text-center">
          {isRefreshing ? (
            <>
              <RefreshCw className="w-10 h-10 mx-auto mb-3 text-primary animate-spin" />
              <p className="text-muted-foreground">Loading today's games...</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Fetching from sportsbooks
              </p>
            </>
          ) : (
            <>
              <Calendar className="w-10 h-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="text-muted-foreground">No NBA games today</p>
              <p className="text-xs text-muted-foreground/70 mt-1">
                Check back when games are scheduled
              </p>
              <Button 
                variant="outline" 
                size="sm" 
                className="mt-4"
                onClick={() => {
                  localStorage.removeItem(CACHE_KEY);
                  setRefreshAttempted(false);
                  triggerAutoRefresh();
                }}
              >
                <RefreshCw className="w-4 h-4 mr-2" />
                Retry
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Calendar className="w-4 h-4 text-primary" />
          Today's Games
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={() => {
                localStorage.removeItem(CACHE_KEY);
                setRefreshAttempted(false);
                triggerAutoRefresh();
              }}
              disabled={isRefreshing}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
            </Button>
            <Badge variant="secondary">
              {games.length} games
            </Badge>
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Roster sync buttons */}
        <div className="flex gap-2 mb-3">
          {selectedGame && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefreshRoster}
              disabled={isRefreshingRoster || isBulkSyncing}
              className="flex-1 border-dashed"
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshingRoster ? 'animate-spin' : ''}`} />
              {isRefreshingRoster ? 'Syncing...' : 'Refresh Game'}
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={handleBulkSyncJerseys}
            disabled={isBulkSyncing || isRefreshingRoster}
            className={selectedGame ? 'flex-1' : 'w-full'}
          >
            <Database className={`w-4 h-4 mr-2 ${isBulkSyncing ? 'animate-pulse' : ''}`} />
            {isBulkSyncing ? 'Syncing All...' : 'Sync All Jerseys'}
          </Button>
        </div>
        
        {games.map((game) => {
          const status = getGameStatus(game.commenceTime);
          const isSelected = selectedGame?.eventId === game.eventId;
          const isLoadingThis = loadingRoster === game.eventId;

          return (
            <Button
              key={game.eventId}
              variant={isSelected ? "default" : "outline"}
              className={`w-full justify-between h-auto py-3 px-4 ${
                isSelected ? 'ring-2 ring-primary' : ''
              }`}
              onClick={() => loadRosters(game)}
              disabled={isLoadingThis}
            >
              <div className="flex flex-col items-start gap-1">
                <div className="flex items-center gap-2">
                  <Users className="w-4 h-4 text-muted-foreground" />
                  <span className="font-medium">{game.awayTeam}</span>
                  <span className="text-muted-foreground">@</span>
                  <span className="font-medium">{game.homeTeam}</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {formatTime(game.commenceTime)}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={status.variant}>{status.label}</Badge>
                {isLoadingThis ? (
                  <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                ) : (
                  <ChevronRight className="w-4 h-4 text-muted-foreground" />
                )}
              </div>
            </Button>
          );
        })}
      </CardContent>
    </Card>
  );
}
