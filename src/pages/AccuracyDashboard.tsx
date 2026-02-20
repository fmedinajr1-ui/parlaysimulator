import { AppShell } from "@/components/layout/AppShell";
import { UnifiedAccuracyView } from "@/components/accuracy/UnifiedAccuracyView";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { PullToRefreshContainer } from "@/components/ui/pull-to-refresh";
import { useQueryClient } from "@tanstack/react-query";

export default function AccuracyDashboard() {
  const queryClient = useQueryClient();

  const { pullProgress, isRefreshing, containerRef, handlers } = usePullToRefresh({
    onRefresh: async () => {
      await queryClient.invalidateQueries({ queryKey: ['unified-accuracy'] });
      await queryClient.invalidateQueries({ queryKey: ['category-hit-rates'] });
    },
  });

  return (
    <AppShell>
      <PullToRefreshContainer
        pullProgress={pullProgress}
        isRefreshing={isRefreshing}
        containerRef={containerRef}
        handlers={handlers}
        className="min-h-screen"
      >
        <div className="container max-w-2xl mx-auto px-4 py-6 pb-6">
          <div className="mb-6">
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <span>📈</span>
              Accuracy Dashboard
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Real-time performance across all prediction systems
            </p>
          </div>

          <UnifiedAccuracyView />
        </div>
      </PullToRefreshContainer>
    </AppShell>
  );
}
