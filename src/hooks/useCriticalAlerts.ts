import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface CriticalAlert {
  id: string;
  event_id: string;
  headline: string;
  news_type: string;
  impact_level: string | null;
  sport: string;
  player_name: string | null;
  home_team: string;
  away_team: string;
  created_at: string | null;
}

interface UseCriticalAlertsReturn {
  alerts: CriticalAlert[];
  isLoading: boolean;
  isConnected: boolean;
  refresh: () => Promise<void>;
}

export function useCriticalAlerts(): UseCriticalAlertsReturn {
  const [alerts, setAlerts] = useState<CriticalAlert[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isConnected, setIsConnected] = useState(false);

  const fetchAlerts = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('game_news_feed')
        .select('*')
        .in('news_type', ['injury', 'sharp_action', 'market_move'])
        .eq('impact_level', 'high')
        .order('created_at', { ascending: false })
        .limit(15);

      if (error) throw error;
      setAlerts(data || []);
    } catch (err) {
      console.error('Error fetching critical alerts:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchAlerts();

    // Real-time subscription
    const channel = supabase
      .channel('critical-alerts')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_news_feed',
        },
        (payload) => {
          const newAlert = payload.new as CriticalAlert;
          // Only add if it's a critical alert
          if (
            ['injury', 'sharp_action', 'market_move'].includes(newAlert.news_type) &&
            newAlert.impact_level === 'high'
          ) {
            setAlerts((prev) => [newAlert, ...prev].slice(0, 15));
          }
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchAlerts, 30000);

    return () => {
      supabase.removeChannel(channel);
      clearInterval(interval);
    };
  }, [fetchAlerts]);

  return { alerts, isLoading, isConnected, refresh: fetchAlerts };
}
