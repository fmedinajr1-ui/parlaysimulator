import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface SharpAlert {
  pickId: string;
  playerName: string;
  propType: string;
  alertLevel: 'warning' | 'extreme' | 'critical';
  movementPts: number;
  direction: string;
  isTrap: boolean;
  detectedAt: Date;
}

interface UseSharpMovementSyncOptions {
  enabled?: boolean;
  showToasts?: boolean;
}

export function useSharpMovementSync(options: UseSharpMovementSyncOptions = {}) {
  const { enabled = true, showToasts = true } = options;
  
  const [sharpAlerts, setSharpAlerts] = useState<SharpAlert[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Handle new sharp alert from realtime subscription
  const handleSharpUpdate = useCallback((payload: any) => {
    const pick = payload.new;
    
    if (pick?.sharp_alert && pick?.sharp_detected_at) {
      const alert: SharpAlert = {
        pickId: pick.id,
        playerName: pick.player_name,
        propType: pick.prop_type,
        alertLevel: pick.sharp_alert_level || 'warning',
        movementPts: pick.sharp_movement_pts || 0,
        direction: pick.sharp_direction || 'unknown',
        isTrap: pick.is_trap_indicator || false,
        detectedAt: new Date(pick.sharp_detected_at)
      };

      setSharpAlerts(prev => {
        // Avoid duplicates
        const exists = prev.some(a => a.pickId === alert.pickId);
        if (exists) {
          return prev.map(a => a.pickId === alert.pickId ? alert : a);
        }
        return [alert, ...prev];
      });

      setLastUpdate(new Date());

      // Show toast notification
      if (showToasts) {
        const emoji = alert.isTrap ? '⚠️' : '🔴';
        const label = alert.isTrap ? 'TRAP WARNING' : 'SHARP MOVE';
        
        toast.warning(`${emoji} ${label}: ${alert.playerName}`, {
          description: `${alert.propType.replace(/_/g, ' ')} - ${alert.movementPts}pts ${alert.direction}`,
          duration: 8000,
        });
      }
    }
  }, [showToasts]);

  // Handle engine tracker updates (for SHARP_SYNC broadcasts)
  const handleEngineUpdate = useCallback((payload: any) => {
    const update = payload.new;
    
    if (update?.engine_name === 'SHARP_SYNC') {
      setLastUpdate(new Date());
      
      if (showToasts && update.signals) {
        const signals = update.signals as any;
        const emoji = signals.is_trap ? '⚠️' : '🔴';
        
        toast.info(`${emoji} Sharp Movement Detected`, {
          description: update.pick_description,
          duration: 6000,
        });
      }
    }
  }, [showToasts]);

  useEffect(() => {
    if (!enabled) return;

    // Subscribe to nba_risk_engine_picks for sharp_alert updates
    const picksChannel = supabase
      .channel('sharp-picks-sync')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'nba_risk_engine_picks',
          filter: 'sharp_alert=eq.true'
        },
        handleSharpUpdate
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    // Subscribe to engine_live_tracker for SHARP_SYNC broadcasts
    const engineChannel = supabase
      .channel('sharp-engine-sync')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'engine_live_tracker',
          filter: 'engine_name=eq.SHARP_SYNC'
        },
        handleEngineUpdate
      )
      .subscribe();

    // Subscribe to extreme_movement_alerts
    const alertsChannel = supabase
      .channel('extreme-alerts-sync')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'extreme_movement_alerts'
        },
        (payload) => {
          const alert = payload.new as any;
          if (alert && showToasts) {
            const level = alert.alert_level;
            const emoji = level === 'critical' ? '🚨' : level === 'extreme' ? '🔴' : '⚠️';
            
            toast.warning(`${emoji} ${level.toUpperCase()} Movement`, {
              description: `${alert.player_name || alert.description} - ${alert.total_movement}pts`,
              duration: 8000,
            });
          }
          setLastUpdate(new Date());
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(picksChannel);
      supabase.removeChannel(engineChannel);
      supabase.removeChannel(alertsChannel);
    };
  }, [enabled, handleSharpUpdate, handleEngineUpdate, showToasts]);

  // Fetch existing sharp alerts on mount
  useEffect(() => {
    if (!enabled) return;

    const fetchExistingAlerts = async () => {
      const today = new Date().toISOString().split('T')[0];
      
      const { data, error } = await supabase
        .from('nba_risk_engine_picks')
        .select('*')
        .eq('sharp_alert', true)
        .gte('game_date', today)
        .order('sharp_detected_at', { ascending: false });

      if (!error && data) {
        const alerts: SharpAlert[] = data.map(pick => ({
          pickId: pick.id,
          playerName: pick.player_name,
          propType: pick.prop_type,
          alertLevel: (pick.sharp_alert_level as SharpAlert['alertLevel']) || 'warning',
          movementPts: pick.sharp_movement_pts || 0,
          direction: pick.sharp_direction || 'unknown',
          isTrap: pick.is_trap_indicator || false,
          detectedAt: new Date(pick.sharp_detected_at || pick.created_at)
        }));
        
        setSharpAlerts(alerts);
      }
    };

    fetchExistingAlerts();
  }, [enabled]);

  // Get alert for a specific pick
  const getAlertForPick = useCallback((pickId: string): SharpAlert | undefined => {
    return sharpAlerts.find(a => a.pickId === pickId);
  }, [sharpAlerts]);

  // Check if a player/prop has a sharp alert
  const hasSharpAlert = useCallback((playerName: string, propType: string): SharpAlert | undefined => {
    return sharpAlerts.find(a => 
      a.playerName.toLowerCase() === playerName.toLowerCase() &&
      a.propType.toLowerCase() === propType.toLowerCase()
    );
  }, [sharpAlerts]);

  return {
    sharpAlerts,
    isConnected,
    lastUpdate,
    getAlertForPick,
    hasSharpAlert,
    alertCount: sharpAlerts.length,
    trapCount: sharpAlerts.filter(a => a.isTrap).length
  };
}
