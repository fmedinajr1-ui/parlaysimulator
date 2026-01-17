import React, { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sparkles, Trash2, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";

export function SlateRefreshControls() {
  const [isClearing, setIsClearing] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const queryClient = useQueryClient();

  const isLoading = isClearing || isRefreshing;

  const invalidateAllQueries = () => {
    queryClient.invalidateQueries({ queryKey: ['riskEnginePicks'] });
    queryClient.invalidateQueries({ queryKey: ['sweetSpotTracking'] });
    queryClient.invalidateQueries({ queryKey: ['propEngineV2'] });
    queryClient.invalidateQueries({ queryKey: ['sharpParlays'] });
    queryClient.invalidateQueries({ queryKey: ['heatParlays'] });
    queryClient.invalidateQueries({ queryKey: ['sweetSpotParlay'] });
    queryClient.invalidateQueries({ queryKey: ['category-sweet-spots-all'] });
    queryClient.invalidateQueries({ queryKey: ['category-parlay-picks-today'] });
  };

  const handleNextSlate = async () => {
    setIsClearing(true);
    toast.info('Clearing stale props...');
    
    try {
      // Step 1: Run cleanup to clear ended games
      const { error: cleanupError } = await supabase.functions.invoke('cleanup-stale-props', {
        body: { immediate: true }
      });
      
      if (cleanupError) {
        console.error('Cleanup error:', cleanupError);
      }
      
      toast.info('Running engine cascade...');
      
      // Step 2: Run full engine cascade for fresh picks
      const { error: cascadeError } = await supabase.functions.invoke('engine-cascade-runner', {
        body: { trigger: 'manual_next_slate', skipPreflight: false }
      });
      
      if (cascadeError) {
        console.error('Cascade error:', cascadeError);
      }
      
      // Step 3: Invalidate all queries to refresh UI
      invalidateAllQueries();
      setLastRefresh(new Date());
      
      toast.success('Next slate loaded! 🎯');
    } catch (err) {
      console.error('Next slate error:', err);
      toast.error('Failed to load next slate');
    } finally {
      setIsClearing(false);
    }
  };

  const handleRefreshEngines = async () => {
    setIsRefreshing(true);
    toast.info('Running full engine refresh...');
    
    try {
      const { error } = await supabase.functions.invoke('engine-cascade-runner', {
        body: { trigger: 'manual_refresh' }
      });
      
      if (error) {
        console.error('Refresh error:', error);
      }
      
      // Invalidate queries
      invalidateAllQueries();
      setLastRefresh(new Date());
      
      toast.success('All engines refreshed! ✨');
    } catch (err) {
      console.error('Refresh error:', err);
      toast.error('Failed to refresh engines');
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-background">
      <CardContent className="py-3 px-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" />
            <div>
              <span className="font-medium text-sm">Slate Control</span>
              <p className="text-xs text-muted-foreground">
                {lastRefresh 
                  ? `Updated ${formatDistanceToNow(lastRefresh, { addSuffix: true })}` 
                  : 'Clear ended games & load fresh picks'}
              </p>
            </div>
          </div>
          
          <div className="flex gap-2">
            {/* Next Slate - Clear & Generate */}
            <Button 
              variant="neon"
              size="sm"
              onClick={handleNextSlate}
              disabled={isLoading}
              className="gap-2"
            >
              {isClearing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Trash2 className="h-4 w-4" />
              )}
              {isClearing ? 'Clearing...' : 'Next Slate'}
            </Button>
            
            {/* Refresh All Engines */}
            <Button 
              variant="outline"
              size="sm"
              onClick={handleRefreshEngines}
              disabled={isLoading}
              className="gap-2"
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isRefreshing ? 'Running...' : 'Refresh'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
