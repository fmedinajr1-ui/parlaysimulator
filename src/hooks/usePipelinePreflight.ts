import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

interface PreflightCheck {
  name: string;
  passed: boolean;
  detail: string;
}

interface PreflightResult {
  isHealthy: boolean;
  blockCode: string | null;
  riskLayerStatus: 'active' | 'thin' | 'empty' | 'bypassed' | null;
  riskLayerBypassed: boolean;
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

  const metadata = data?.metadata as {
    ready?: boolean;
    blockers?: string[];
    checks?: PreflightCheck[];
    risk_layer_status?: string;
    risk_layer_bypassed?: boolean;
    input_quality?: { direct_risk_candidates?: number };
  } | null;

  const rawRiskStatus = (metadata as any)?.input_quality
    ? ((metadata as any).input_quality.direct_risk_candidates ?? 0) === 0
      ? 'empty'
      : ((metadata as any).input_quality.direct_risk_candidates ?? 0) < 8
        ? 'thin'
        : 'active'
    : null;
  const riskLayerStatus = (metadata?.risk_layer_status as PreflightResult['riskLayerStatus'])
    ?? rawRiskStatus
    ?? null;

  return {
    isHealthy: metadata?.ready ?? true,
    blockCode: typeof (metadata as any)?.block_code === 'string' ? (metadata as any).block_code : null,
    riskLayerStatus,
    riskLayerBypassed: metadata?.risk_layer_bypassed ?? true,
    blockers: metadata?.blockers ?? [],
    checks: metadata?.checks ?? [],
    lastCheckTime: data?.created_at ?? null,
    isLoading,
    refetch,
  };
}
