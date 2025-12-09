import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, TrendingUp, TrendingDown, Zap, Activity } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ExtremeMovementBadgeProps {
  eventId?: string;
  description?: string;
  className?: string;
  compact?: boolean;
}

interface MovementAlert {
  id: string;
  event_id: string;
  description: string;
  total_movement: number;
  movement_percentage: number;
  direction: string;
  alert_level: 'warning' | 'extreme' | 'critical';
  opening_price: number;
  current_price: number;
  is_trap_indicator: boolean;
  reasons: string[];
}

export function ExtremeMovementBadge({
  eventId,
  description,
  className,
  compact = false
}: ExtremeMovementBadgeProps) {
  const [alert, setAlert] = useState<MovementAlert | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchAlert() {
      try {
        let query = supabase
          .from('extreme_movement_alerts')
          .select('*')
          .order('total_movement', { ascending: false })
          .limit(1);

        if (eventId) {
          query = query.eq('event_id', eventId);
        } else if (description) {
          query = query.ilike('description', `%${description.slice(0, 30)}%`);
        } else {
          setLoading(false);
          return;
        }

        const { data, error } = await query.maybeSingle();

        if (error) {
          console.error('Error fetching movement alert:', error);
        } else if (data) {
          // Parse reasons if it's a string
          const parsedData = {
            ...data,
            reasons: typeof data.reasons === 'string' 
              ? JSON.parse(data.reasons) 
              : (data.reasons || [])
          };
          setAlert(parsedData as MovementAlert);
        }
      } catch (error) {
        console.error('Error:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchAlert();
  }, [eventId, description]);

  if (loading || !alert) {
    return null;
  }

  const getAlertStyles = (level: string) => {
    switch (level) {
      case 'critical':
        return {
          bg: 'bg-red-500/20',
          border: 'border-red-500/40',
          text: 'text-red-400',
          icon: AlertTriangle,
          label: 'CRITICAL'
        };
      case 'extreme':
        return {
          bg: 'bg-orange-500/20',
          border: 'border-orange-500/40',
          text: 'text-orange-400',
          icon: Zap,
          label: 'EXTREME'
        };
      default:
        return {
          bg: 'bg-yellow-500/20',
          border: 'border-yellow-500/40',
          text: 'text-yellow-400',
          icon: Activity,
          label: 'WARNING'
        };
    }
  };

  const styles = getAlertStyles(alert.alert_level);
  const Icon = styles.icon;
  const DirectionIcon = alert.direction === 'shortened' ? TrendingDown : TrendingUp;

  if (compact) {
    return (
      <Badge 
        variant="outline"
        className={cn(
          "text-xs border",
          styles.bg,
          styles.border,
          styles.text,
          className
        )}
      >
        <Icon className="w-3 h-3 mr-1" />
        {Math.round(alert.total_movement)}pt move
      </Badge>
    );
  }

  return (
    <div className={cn(
      "p-3 rounded-lg border",
      styles.bg,
      styles.border,
      className
    )}>
      <div className="flex items-start gap-2">
        <Icon className={cn("w-5 h-5 shrink-0 mt-0.5", styles.text)} />
        <div className="flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge 
              variant="outline" 
              className={cn("text-xs border", styles.bg, styles.border, styles.text)}
            >
              {styles.label}
            </Badge>
            <span className={cn("text-sm font-bold", styles.text)}>
              {Math.round(alert.total_movement)} POINT MOVEMENT
            </span>
            {alert.is_trap_indicator && (
              <Badge variant="outline" className="text-xs bg-red-500/20 text-red-400 border-red-500/30">
                ⚠️ TRAP
              </Badge>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DirectionIcon className={cn(
              "w-4 h-4",
              alert.direction === 'shortened' ? 'text-emerald-400' : 'text-red-400'
            )} />
            <span>
              {alert.direction === 'shortened' ? 'Shortened' : 'Lengthened'} from{' '}
              <strong className="text-foreground">
                {alert.opening_price > 0 ? `+${alert.opening_price}` : alert.opening_price}
              </strong>
              {' → '}
              <strong className={styles.text}>
                {alert.current_price > 0 ? `+${alert.current_price}` : alert.current_price}
              </strong>
            </span>
            <span className="text-muted-foreground">
              ({alert.movement_percentage.toFixed(1)}%)
            </span>
          </div>

          {alert.reasons && alert.reasons.length > 0 && (
            <ul className="text-xs space-y-1">
              {alert.reasons.slice(0, 3).map((reason, idx) => (
                <li key={idx} className="text-muted-foreground">
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
