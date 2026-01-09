import { useEffect, useState, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { Activity, Zap, Target, Flame, BarChart3 } from "lucide-react";

interface ActivityItem {
  id: string;
  engine_name: string;
  pick_description: string;
  created_at: string;
  sport: string;
}

const engineIcons: Record<string, React.ReactNode> = {
  'risk-engine': <Target className="w-3.5 h-3.5" />,
  'prop-engine-v2': <BarChart3 className="w-3.5 h-3.5" />,
  'sharp-builder': <Zap className="w-3.5 h-3.5" />,
  'heat-engine': <Flame className="w-3.5 h-3.5" />,
};

const engineColors: Record<string, string> = {
  'risk-engine': 'text-blue-400',
  'prop-engine-v2': 'text-purple-400',
  'sharp-builder': 'text-amber-400',
  'heat-engine': 'text-orange-400',
};

export function EngineActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch initial data
    const fetchInitialData = async () => {
      const { data } = await supabase
        .from('engine_live_tracker')
        .select('id, engine_name, pick_description, created_at, sport')
        .order('created_at', { ascending: false })
        .limit(50);
      
      if (data) {
        setActivities(data);
      }
    };

    fetchInitialData();

    // Subscribe to realtime updates
    const channel = supabase
      .channel('engine-activity-feed')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'engine_live_tracker'
        },
        (payload) => {
          const newActivity = payload.new as ActivityItem;
          setActivities(prev => [newActivity, ...prev.slice(0, 49)]);
        }
      )
      .subscribe((status) => {
        setIsConnected(status === 'SUBSCRIBED');
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  // Auto-scroll when not paused
  useEffect(() => {
    if (!isPaused && scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [activities, isPaused]);

  return (
    <div className="rounded-2xl bg-card border border-border/50 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          <h3 className="font-semibold text-foreground">Recent Activity</h3>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "flex items-center gap-1.5 text-xs",
            isConnected ? "text-emerald-400" : "text-muted-foreground"
          )}>
            <span className={cn(
              "w-1.5 h-1.5 rounded-full",
              isConnected ? "bg-emerald-500 animate-pulse" : "bg-muted-foreground"
            )} />
            {isConnected ? "Live" : "Connecting..."}
          </span>
        </div>
      </div>

      {/* Activity List */}
      <div
        ref={scrollRef}
        className="max-h-[300px] overflow-y-auto"
        onMouseEnter={() => setIsPaused(true)}
        onMouseLeave={() => setIsPaused(false)}
      >
        {activities.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground text-sm">
            No recent activity
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {activities.map((activity) => {
              const engineKey = activity.engine_name.toLowerCase().replace(/\s+/g, '-');
              const icon = engineIcons[engineKey] || <Activity className="w-3.5 h-3.5" />;
              const colorClass = engineColors[engineKey] || 'text-muted-foreground';

              return (
                <div
                  key={activity.id}
                  className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div className={cn("mt-0.5", colorClass)}>
                    {icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={cn("text-xs font-medium", colorClass)}>
                        {activity.engine_name}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(activity.created_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="text-sm text-foreground truncate mt-0.5">
                      {activity.pick_description}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
