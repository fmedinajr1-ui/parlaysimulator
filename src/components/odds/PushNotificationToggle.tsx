import { useState } from "react";
import { usePushNotifications } from "@/hooks/usePushNotifications";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { FeedCard } from "@/components/FeedCard";
import { Bell, BellOff, BellRing, Loader2, Smartphone } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SPORTS_OPTIONS = [
  { value: "all", label: "All Sports" },
  { value: "basketball_nba", label: "NBA" },
  { value: "americanfootball_nfl", label: "NFL" },
  { value: "basketball_ncaab", label: "NCAAB" },
  { value: "americanfootball_ncaaf", label: "NCAAF" },
  { value: "icehockey_nhl", label: "NHL" },
  { value: "baseball_mlb", label: "MLB" },
];

export function PushNotificationToggle() {
  const { 
    isSupported, 
    isSubscribed, 
    isLoading, 
    permission,
    subscribe, 
    unsubscribe 
  } = usePushNotifications();

  const [selectedSport, setSelectedSport] = useState("all");
  const [sharpOnly, setSharpOnly] = useState(true);

  const handleToggle = async () => {
    if (isSubscribed) {
      await unsubscribe();
    } else {
      const sportsFilter = selectedSport === "all" ? [] : [selectedSport];
      await subscribe(sportsFilter, sharpOnly);
    }
  };

  if (!isSupported) {
    return (
      <FeedCard>
        <div className="flex items-center gap-3 text-muted-foreground">
          <BellOff className="w-5 h-5" />
          <div>
            <p className="text-sm font-medium">Push Notifications Unavailable</p>
            <p className="text-xs">Your browser doesn't support push notifications</p>
          </div>
        </div>
      </FeedCard>
    );
  }

  return (
    <FeedCard>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {isSubscribed ? (
              <BellRing className="w-5 h-5 text-neon-green" />
            ) : (
              <Bell className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <p className="text-sm font-medium text-foreground">Sharp Money Alerts</p>
              <p className="text-xs text-muted-foreground">
                Get notified when sharp action is detected
              </p>
            </div>
          </div>
          
          {isSubscribed && (
            <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30">
              Active
            </Badge>
          )}
        </div>

        {/* Settings (only show when not subscribed) */}
        {!isSubscribed && (
          <div className="space-y-3 pt-2 border-t border-border/50">
            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">Sport Filter</label>
              <Select value={selectedSport} onValueChange={setSelectedSport}>
                <SelectTrigger className="w-32 h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SPORTS_OPTIONS.map((sport) => (
                    <SelectItem key={sport.value} value={sport.value}>
                      {sport.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-center justify-between">
              <label className="text-sm text-muted-foreground">Sharp moves only</label>
              <Switch
                checked={sharpOnly}
                onCheckedChange={setSharpOnly}
              />
            </div>
          </div>
        )}

        {/* Action Button */}
        <Button
          variant={isSubscribed ? "outline" : "default"}
          className={`w-full ${isSubscribed ? '' : 'bg-neon-green text-background hover:bg-neon-green/90'}`}
          onClick={handleToggle}
          disabled={isLoading}
        >
          {isLoading ? (
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
          ) : isSubscribed ? (
            <BellOff className="w-4 h-4 mr-2" />
          ) : (
            <Bell className="w-4 h-4 mr-2" />
          )}
          {isLoading 
            ? 'Processing...' 
            : isSubscribed 
              ? 'Disable Notifications' 
              : 'Enable Push Notifications'
          }
        </Button>

        {/* Permission Warning */}
        {permission === 'denied' && (
          <div className="flex items-center gap-2 p-2 rounded-lg bg-destructive/10 border border-destructive/30">
            <Smartphone className="w-4 h-4 text-destructive" />
            <p className="text-xs text-destructive">
              Notifications blocked. Please enable them in your browser settings.
            </p>
          </div>
        )}
      </div>
    </FeedCard>
  );
}
