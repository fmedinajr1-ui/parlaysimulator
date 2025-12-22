import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface EngineUpdate {
  id: string;
  engine_name: string;
  event_id?: string;
  player_name?: string;
  prop_type?: string;
  sport: string;
  pick_description: string;
  confidence?: number;
  confidence_level?: string;
  signals?: any;
  status?: string;
  created_at: string;
  updated_at?: string;
}

interface UseEngineRealtimeOptions {
  sport?: string;
  engineFilter?: string[];
  eventId?: string;
  showToasts?: boolean;
}

export function useEngineRealtime(options: UseEngineRealtimeOptions = {}) {
  const { sport, engineFilter, eventId, showToasts = true } = options;
  
  const [updates, setUpdates] = useState<EngineUpdate[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Fetch initial data
  const fetchInitialData = useCallback(async () => {
    setIsLoading(true);
    try {
      let query = supabase
        .from('engine_live_tracker')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (sport) {
        query = query.eq('sport', sport);
      }
      if (eventId) {
        query = query.eq('event_id', eventId);
      }
      if (engineFilter && engineFilter.length > 0) {
        query = query.in('engine_name', engineFilter);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching engine updates:', error);
        return;
      }

      if (data) {
        setUpdates(data as EngineUpdate[]);
        if (data.length > 0) {
          setLastUpdate(new Date(data[0].created_at));
        }
      }
    } catch (err) {
      console.error('Error in fetchInitialData:', err);
    } finally {
      setIsLoading(false);
    }
  }, [sport, eventId, engineFilter]);

  // Handle new update from realtime
  const handleNewUpdate = useCallback((payload: any) => {
    const newUpdate = payload.new as EngineUpdate;
    
    // Check if update matches filters
    if (sport && newUpdate.sport !== sport) return;
    if (eventId && newUpdate.event_id !== eventId) return;
    if (engineFilter && engineFilter.length > 0 && !engineFilter.includes(newUpdate.engine_name)) return;

    setUpdates(prev => {
      // Check if this update already exists
      const existingIndex = prev.findIndex(u => u.id === newUpdate.id);
      if (existingIndex >= 0) {
        // Update existing
        const updated = [...prev];
        updated[existingIndex] = newUpdate;
        return updated;
      }
      // Add new at the beginning
      return [newUpdate, ...prev.slice(0, 49)];
    });

    setLastUpdate(new Date());

    if (showToasts) {
      toast.info(`${newUpdate.engine_name} updated`, {
        description: newUpdate.pick_description?.slice(0, 50),
        duration: 3000,
      });
    }
  }, [sport, eventId, engineFilter, showToasts]);

  // Handle update change
  const handleUpdateChange = useCallback((payload: any) => {
    const updatedRecord = payload.new as EngineUpdate;
    
    setUpdates(prev => {
      const index = prev.findIndex(u => u.id === updatedRecord.id);
      if (index >= 0) {
        const updated = [...prev];
        updated[index] = updatedRecord;
        return updated;
      }
      return prev;
    });

    setLastUpdate(new Date());
  }, []);

  // Handle delete
  const handleDelete = useCallback((payload: any) => {
    const deletedId = payload.old?.id;
    if (deletedId) {
      setUpdates(prev => prev.filter(u => u.id !== deletedId));
    }
  }, []);

  // Set up realtime subscription
  useEffect(() => {
    fetchInitialData();

    const channel = supabase
      .channel('engine-live-tracker-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'engine_live_tracker',
        },
        handleNewUpdate
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'engine_live_tracker',
        },
        handleUpdateChange
      )
      .on(
        'postgres_changes',
        {
          event: 'DELETE',
          schema: 'public',
          table: 'engine_live_tracker',
        },
        handleDelete
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [fetchInitialData, handleNewUpdate, handleUpdateChange, handleDelete]);

  // Get time since last update
  const getTimeSinceUpdate = useCallback(() => {
    if (!lastUpdate) return 'Never';
    
    const seconds = Math.floor((Date.now() - lastUpdate.getTime()) / 1000);
    
    if (seconds < 5) return 'Just now';
    if (seconds < 60) return `${seconds}s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    return `${Math.floor(seconds / 3600)}h ago`;
  }, [lastUpdate]);

  // Get updates by engine
  const getUpdatesByEngine = useCallback((engineName: string) => {
    return updates.filter(u => u.engine_name === engineName);
  }, [updates]);

  // Get update for specific event/player
  const getUpdateForLeg = useCallback((legEventId: string, playerName?: string) => {
    return updates.find(u => 
      u.event_id === legEventId && 
      (!playerName || u.player_name?.toLowerCase() === playerName.toLowerCase())
    );
  }, [updates]);

  // Refresh data manually
  const refresh = useCallback(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  return {
    updates,
    isConnected,
    isLoading,
    lastUpdate,
    getTimeSinceUpdate,
    getUpdatesByEngine,
    getUpdateForLeg,
    refresh,
  };
}
