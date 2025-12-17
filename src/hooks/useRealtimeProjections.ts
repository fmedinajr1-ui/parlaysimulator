import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface ProjectionUpdate {
  id: string;
  playerName: string;
  propType: string;
  previousProjection: number | null;
  newProjection: number;
  changePercent: number;
  affectedLine: number | null;
  previousProbability: number | null;
  newProbability: number | null;
  changeReason: string;
  isSignificant: boolean;
  createdAt: Date;
}

interface UseRealtimeProjectionsOptions {
  playerNames?: string[];
  propTypes?: string[];
  onlySignificant?: boolean;
  showToasts?: boolean;
}

export function useRealtimeProjections(options: UseRealtimeProjectionsOptions = {}) {
  const { playerNames, propTypes, onlySignificant = true, showToasts = true } = options;
  const { toast } = useToast();
  
  const [updates, setUpdates] = useState<ProjectionUpdate[]>([]);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // Convert database row to ProjectionUpdate
  const mapDbRowToUpdate = useCallback((row: any): ProjectionUpdate => ({
    id: row.id,
    playerName: row.player_name,
    propType: row.prop_type,
    previousProjection: row.previous_projection,
    newProjection: row.new_projection,
    changePercent: row.change_percent,
    affectedLine: row.affected_line,
    previousProbability: row.previous_probability,
    newProbability: row.new_probability,
    changeReason: row.change_reason,
    isSignificant: row.is_significant,
    createdAt: new Date(row.created_at),
  }), []);

  // Check if update matches filters
  const matchesFilters = useCallback((update: ProjectionUpdate): boolean => {
    if (playerNames && playerNames.length > 0) {
      if (!playerNames.some(name => 
        update.playerName.toLowerCase().includes(name.toLowerCase())
      )) {
        return false;
      }
    }

    if (propTypes && propTypes.length > 0) {
      if (!propTypes.some(type => 
        update.propType.toLowerCase().includes(type.toLowerCase())
      )) {
        return false;
      }
    }

    if (onlySignificant && !update.isSignificant) {
      return false;
    }

    return true;
  }, [playerNames, propTypes, onlySignificant]);

  // Show toast for significant updates
  const showUpdateToast = useCallback((update: ProjectionUpdate) => {
    if (!showToasts || !update.isSignificant) return;

    const direction = update.changePercent > 0 ? '↑' : '↓';
    const probChange = update.newProbability && update.previousProbability
      ? `${Math.round(update.previousProbability * 100)}% → ${Math.round(update.newProbability * 100)}%`
      : '';

    toast({
      title: `${update.playerName} ${update.propType} Updated`,
      description: `${direction} ${Math.abs(update.changePercent).toFixed(1)}% | ${probChange}`,
      variant: update.changePercent > 0 ? 'default' : 'destructive',
    });
  }, [showToasts, toast]);

  // Fetch initial recent updates
  const fetchRecentUpdates = useCallback(async () => {
    setIsLoading(true);
    try {
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
      
      let query = supabase
        .from('projection_updates')
        .select('*')
        .gte('created_at', oneHourAgo)
        .order('created_at', { ascending: false })
        .limit(50);

      if (onlySignificant) {
        query = query.eq('is_significant', true);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching projection updates:', error);
        return;
      }

      const mappedUpdates = (data || []).map(mapDbRowToUpdate).filter(matchesFilters);
      setUpdates(mappedUpdates);
      setLastRefresh(new Date());
    } catch (error) {
      console.error('Error in fetchRecentUpdates:', error);
    } finally {
      setIsLoading(false);
    }
  }, [mapDbRowToUpdate, matchesFilters, onlySignificant]);

  // Trigger manual refresh via edge function
  const triggerRefresh = useCallback(async (playerName?: string, propType?: string) => {
    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('auto-refresh-projections', {
        body: {
          action: playerName ? 'refresh_player' : 'refresh_all',
          playerName,
          propType,
          sport: 'NBA',
        },
      });

      if (error) {
        console.error('Error triggering refresh:', error);
        throw error;
      }

      // Fetch updated data after refresh
      await fetchRecentUpdates();

      return data;
    } catch (error) {
      console.error('Error in triggerRefresh:', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [fetchRecentUpdates]);

  // Subscribe to realtime updates
  useEffect(() => {
    // Fetch initial data
    fetchRecentUpdates();

    // Set up realtime subscription
    const channel = supabase
      .channel('projection-updates-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'projection_updates',
        },
        (payload) => {
          console.log('Realtime projection update received:', payload);
          const update = mapDbRowToUpdate(payload.new);
          
          if (matchesFilters(update)) {
            setUpdates(prev => [update, ...prev.slice(0, 49)]);
            setLastRefresh(new Date());
            showUpdateToast(update);
          }
        }
      )
      .subscribe((status) => {
        console.log('Projection updates subscription status:', status);
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchRecentUpdates, mapDbRowToUpdate, matchesFilters, showUpdateToast]);

  // Get updates for a specific player
  const getPlayerUpdates = useCallback((playerName: string) => {
    return updates.filter(u => 
      u.playerName.toLowerCase().includes(playerName.toLowerCase())
    );
  }, [updates]);

  // Get the most recent update for a player/prop combination
  const getLatestUpdate = useCallback((playerName: string, propType: string) => {
    return updates.find(u => 
      u.playerName.toLowerCase().includes(playerName.toLowerCase()) &&
      u.propType.toLowerCase().includes(propType.toLowerCase())
    );
  }, [updates]);

  // Check if a player has any significant recent changes
  const hasSignificantChange = useCallback((playerName: string) => {
    const playerUpdates = getPlayerUpdates(playerName);
    return playerUpdates.some(u => u.isSignificant);
  }, [getPlayerUpdates]);

  return {
    updates,
    lastRefresh,
    isConnected,
    isLoading,
    triggerRefresh,
    fetchRecentUpdates,
    getPlayerUpdates,
    getLatestUpdate,
    hasSignificantChange,
  };
}

// Hook for tracking a single player's projections
export function usePlayerProjection(playerName: string, propType: string) {
  const { getLatestUpdate, isConnected, isLoading, triggerRefresh } = useRealtimeProjections({
    playerNames: [playerName],
    propTypes: [propType],
    showToasts: false,
  });

  const latestUpdate = getLatestUpdate(playerName, propType);

  const refresh = useCallback(() => {
    return triggerRefresh(playerName, propType);
  }, [triggerRefresh, playerName, propType]);

  return {
    update: latestUpdate,
    isConnected,
    isLoading,
    refresh,
  };
}
