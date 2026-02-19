import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface PreflightResult {
  isHealthy: boolean;
  blockers: string[];
  checks: PreflightCheck[];
  lastCheckTime: string | null;
  isLoading: boolean;
  refetch: () => void;
}

export function usePipelinePreflight(): PreflightResult {
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['pipeline-preflight-status'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bot_activity_log')
        .select('*')
        .eq('event_type', 'preflight_check')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) throw error;
      return data;
    },
    refetchInterval: 60000,
    staleTime: 30000,
  });

  const metadata = data?.metadata as { ready?: boolean; blockers?: string[]; checks?: PreflightCheck[] } | null;

  return {
    isHealthy: metadata?.ready ?? true,
    blockers: metadata?.blockers ?? [],
    checks: metadata?.checks ?? [],
    lastCheckTime: data?.created_at ?? null,
    isLoading,
    refetch,
  };
}
