import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, BellOff, Loader2, Mail, Sparkles, Check, Target } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const SPORTS = ["NBA", "NFL", "NHL", "MLB", "NCAAB", "NCAAF", "Soccer"];

export function NotificationPreferences() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [hasPrefs, setHasPrefs] = useState(false);
  
  const [emailNotifications, setEmailNotifications] = useState(true);
  const [juicedPicksEmail, setJuicedPicksEmail] = useState(true);
  const [minConfidence, setMinConfidence] = useState(0.5);
  const [favoriteSports, setFavoriteSports] = useState<string[]>([]);
  const [email, setEmail] = useState("");

  useEffect(() => {
    if (user) {
      fetchPreferences();
    }
  }, [user]);

  const fetchPreferences = async () => {
    if (!user) return;
    
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;

      if (data) {
        setHasPrefs(true);
        setEmailNotifications(data.email_notifications);
        setJuicedPicksEmail(data.juiced_picks_email ?? true);
        setMinConfidence(data.min_confidence_threshold);
        setFavoriteSports(data.favorite_sports || []);
        setEmail(data.email);
        setFavoriteSports(data.favorite_sports || []);
        setEmail(data.email);
      } else {
        // Set default email from auth
        setEmail(user.email || "");
      }
    } catch (error) {
      console.error('Error fetching preferences:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const savePreferences = async () => {
    if (!user) return;
    
    setIsSaving(true);
    try {
      const prefsData = {
        user_id: user.id,
        email: email || user.email,
        email_notifications: emailNotifications,
        juiced_picks_email: juicedPicksEmail,
        min_confidence_threshold: minConfidence,
        favorite_sports: favoriteSports,
      };

      if (hasPrefs) {
        const { error } = await supabase
          .from('notification_preferences')
          .update(prefsData)
          .eq('user_id', user.id);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('notification_preferences')
          .insert(prefsData);
        if (error) throw error;
        setHasPrefs(true);
      }

      toast({
        title: "Preferences Saved",
        description: emailNotifications 
          ? "You'll receive alerts for high-confidence parlays" 
          : "Email notifications disabled",
      });
    } catch (error) {
      console.error('Error saving preferences:', error);
      toast({
        title: "Error",
        description: "Failed to save preferences",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const toggleSport = (sport: string) => {
    setFavoriteSports(prev => 
      prev.includes(sport) 
        ? prev.filter(s => s !== sport)
        : [...prev, sport]
    );
  };

  const getConfidenceLabel = (value: number) => {
    if (value >= 0.6) return "High only";
    if (value >= 0.4) return "Medium+";
    return "All";
  };

  if (!user) return null;

  if (isLoading) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-display flex items-center gap-2">
          <Bell className="w-4 h-4 text-primary" />
          PARLAY ALERTS
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Email Toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {emailNotifications ? (
              <Mail className="w-5 h-5 text-primary" />
            ) : (
              <BellOff className="w-5 h-5 text-muted-foreground" />
            )}
            <div>
              <Label htmlFor="email-notifications" className="text-sm font-medium">
                Email Notifications
              </Label>
              <p className="text-xs text-muted-foreground">
                Get alerts when new high-confidence parlays are found
              </p>
            </div>
          </div>
          <Switch
            id="email-notifications"
            checked={emailNotifications}
            onCheckedChange={setEmailNotifications}
          />
        </div>

        {emailNotifications && (
          <>
            {/* Juiced Props Final Picks Toggle */}
            <div className="flex items-center justify-between pt-2 pb-2 border-b border-border/30">
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-primary" />
                <div>
                  <Label htmlFor="juiced-picks-email" className="text-sm font-medium">
                    Final Picks Alerts
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Get email when final picks are locked (30-90 min before games)
                  </p>
                </div>
              </div>
              <Switch
                id="juiced-picks-email"
                checked={juicedPicksEmail}
                onCheckedChange={setJuicedPicksEmail}
              />
            </div>

            {/* Confidence Threshold */}
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Minimum Confidence</Label>
                <Badge variant="outline" className="text-xs">
                  {getConfidenceLabel(minConfidence)} ({(minConfidence * 100).toFixed(0)}%+)
                </Badge>
              </div>
              <Slider
                value={[minConfidence]}
                onValueChange={([value]) => setMinConfidence(value)}
                min={0.3}
                max={0.7}
                step={0.1}
                className="w-full"
              />
              <p className="text-xs text-muted-foreground">
                Only get alerts for parlays with confidence above this threshold
              </p>
            </div>

            {/* Sport Preferences */}
            <div className="space-y-2 pt-2">
              <Label className="text-sm">Alert for Sports (optional)</Label>
              <div className="flex flex-wrap gap-2">
                {SPORTS.map(sport => (
                  <Badge
                    key={sport}
                    variant={favoriteSports.includes(sport) ? "default" : "outline"}
                    className={cn(
                      "cursor-pointer transition-all",
                      favoriteSports.includes(sport) && "bg-primary"
                    )}
                    onClick={() => toggleSport(sport)}
                  >
                    {favoriteSports.includes(sport) && (
                      <Check className="w-3 h-3 mr-1" />
                    )}
                    {sport}
                  </Badge>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                {favoriteSports.length === 0 
                  ? "Leave empty to get alerts for all sports"
                  : `Only get alerts for ${favoriteSports.join(", ")}`
                }
              </p>
            </div>
          </>
        )}

        {/* Save Button */}
        <Button 
          onClick={savePreferences} 
          disabled={isSaving}
          className="w-full"
        >
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Saving...
            </>
          ) : (
            <>
              <Sparkles className="w-4 h-4 mr-2" />
              {hasPrefs ? "Update Preferences" : "Enable Alerts"}
            </>
          )}
        </Button>

        {/* Info */}
        <p className="text-xs text-muted-foreground text-center">
          Alerts are sent max once every 6 hours when new parlays match your criteria
        </p>
      </CardContent>
    </Card>
  );
}
