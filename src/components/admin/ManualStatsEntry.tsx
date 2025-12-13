import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Database, Plus, Loader2, RefreshCw, Download, Calendar } from "lucide-react";

interface ManualStatsEntryProps {
  onStatsAdded?: () => void;
}

export const ManualStatsEntry = ({ onStatsAdded }: ManualStatsEntryProps) => {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [formData, setFormData] = useState({
    player_name: "",
    game_date: new Date().toISOString().split("T")[0],
    opponent: "",
    points: "",
    rebounds: "",
    assists: "",
    threes_made: "",
    blocks: "",
    steals: "",
  });
  const [backfillDays, setBackfillDays] = useState("5");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.player_name || !formData.game_date) {
      toast.error("Player name and game date are required");
      return;
    }

    setIsSubmitting(true);
    try {
      const { error } = await supabase.from("nba_player_game_logs").upsert({
        player_name: formData.player_name.trim(),
        game_date: formData.game_date,
        opponent: formData.opponent || "Unknown",
        points: parseInt(formData.points) || 0,
        rebounds: parseInt(formData.rebounds) || 0,
        assists: parseInt(formData.assists) || 0,
        threes_made: parseInt(formData.threes_made) || 0,
        blocks: parseInt(formData.blocks) || 0,
        steals: parseInt(formData.steals) || 0,
        is_home: true,
      }, { onConflict: 'player_name,game_date' });

      if (error) throw error;

      toast.success(`Stats added for ${formData.player_name}`);
      setFormData(prev => ({ ...prev, player_name: "", points: "", rebounds: "", assists: "", threes_made: "", blocks: "", steals: "" }));
      onStatsAdded?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to add stats");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleFetchMissingStats = async () => {
    setIsFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke("nba-stats-fetcher", {
        body: { mode: "sync" },
      });

      if (error) throw error;

      toast.success(`Fetched stats: ${data?.results?.statsInserted || 0} records`);
      onStatsAdded?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to fetch stats");
    } finally {
      setIsFetching(false);
    }
  };

  const handleBackfillStats = async () => {
    setIsBackfilling(true);
    try {
      const days = parseInt(backfillDays) || 5;
      const endDate = new Date().toISOString().split('T')[0];
      const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
      
      toast.info(`Backfilling stats from ${startDate} to ${endDate}...`);
      
      const { data, error } = await supabase.functions.invoke("backfill-player-stats", {
        body: { startDate, endDate, useESPN: true, useBDL: true },
      });

      if (error) throw error;

      const results = data?.results || {};
      toast.success(
        `Backfill complete! ESPN: ${results.espnStatsFound || 0}, BDL: ${results.bdlStatsFound || 0}, Inserted: ${results.statsInserted || 0}`
      );
      onStatsAdded?.();
    } catch (error: any) {
      toast.error(error.message || "Failed to backfill stats");
    } finally {
      setIsBackfilling(false);
    }
  };

  return (
    <Card className="border-dashed border-amber-500/30">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Database className="h-4 w-4 text-amber-500" />
          Stats Data Management
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Backfill Section */}
        <div className="p-3 bg-amber-500/10 rounded-lg space-y-3">
          <div className="flex items-center gap-2 text-xs text-amber-400">
            <Download className="h-3 w-3" />
            <span className="font-medium">Backfill Missing Stats (ESPN + API)</span>
          </div>
          <div className="flex gap-2">
            <div className="flex-1">
              <Label className="text-xs">Days to backfill</Label>
              <Input
                type="number"
                value={backfillDays}
                onChange={(e) => setBackfillDays(e.target.value)}
                placeholder="5"
                className="h-8 text-sm"
                min="1"
                max="14"
              />
            </div>
            <div className="flex items-end">
              <Button
                onClick={handleBackfillStats}
                disabled={isBackfilling}
                variant="default"
                size="sm"
                className="bg-amber-600 hover:bg-amber-700"
              >
                {isBackfilling ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Calendar className="h-4 w-4 mr-2" />
                )}
                Backfill Stats
              </Button>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Fetches all NBA player stats from ESPN and BallDontLie for the selected date range
          </p>
        </div>

        {/* Quick Sync Button */}
        <Button
          onClick={handleFetchMissingStats}
          disabled={isFetching}
          variant="outline"
          size="sm"
          className="w-full"
        >
          {isFetching ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4 mr-2" />
          )}
          Quick Sync (Today Only)
        </Button>

        {/* Manual Entry Form */}
        <div className="border-t border-border pt-4">
          <p className="text-xs text-muted-foreground mb-3">Or manually add individual stats:</p>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Player Name</Label>
                <Input
                  value={formData.player_name}
                  onChange={(e) => setFormData(prev => ({ ...prev, player_name: e.target.value }))}
                  placeholder="LeBron James"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Game Date</Label>
                <Input
                  type="date"
                  value={formData.game_date}
                  onChange={(e) => setFormData(prev => ({ ...prev, game_date: e.target.value }))}
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div>
              <Label className="text-xs">Opponent</Label>
              <Input
                value={formData.opponent}
                onChange={(e) => setFormData(prev => ({ ...prev, opponent: e.target.value }))}
                placeholder="Lakers"
                className="h-8 text-sm"
              />
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Points</Label>
                <Input
                  type="number"
                  value={formData.points}
                  onChange={(e) => setFormData(prev => ({ ...prev, points: e.target.value }))}
                  placeholder="25"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Rebounds</Label>
                <Input
                  type="number"
                  value={formData.rebounds}
                  onChange={(e) => setFormData(prev => ({ ...prev, rebounds: e.target.value }))}
                  placeholder="8"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Assists</Label>
                <Input
                  type="number"
                  value={formData.assists}
                  onChange={(e) => setFormData(prev => ({ ...prev, assists: e.target.value }))}
                  placeholder="6"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">3PM</Label>
                <Input
                  type="number"
                  value={formData.threes_made}
                  onChange={(e) => setFormData(prev => ({ ...prev, threes_made: e.target.value }))}
                  placeholder="3"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Blocks</Label>
                <Input
                  type="number"
                  value={formData.blocks}
                  onChange={(e) => setFormData(prev => ({ ...prev, blocks: e.target.value }))}
                  placeholder="1"
                  className="h-8 text-sm"
                />
              </div>
              <div>
                <Label className="text-xs">Steals</Label>
                <Input
                  type="number"
                  value={formData.steals}
                  onChange={(e) => setFormData(prev => ({ ...prev, steals: e.target.value }))}
                  placeholder="2"
                  className="h-8 text-sm"
                />
              </div>
            </div>

            <Button
              type="submit"
              disabled={isSubmitting}
              size="sm"
              variant="secondary"
              className="w-full"
            >
              {isSubmitting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Plus className="h-4 w-4 mr-2" />
              )}
              Add Stats Entry
            </Button>
          </form>
        </div>
      </CardContent>
    </Card>
  );
};
