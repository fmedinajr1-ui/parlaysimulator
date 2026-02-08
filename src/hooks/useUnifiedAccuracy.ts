import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { calculateGrade } from "@/lib/accuracy-calculator";

export interface SystemAccuracy {
  systemName: string;
  displayName: string;
  icon: string;
  totalPicks: number;
  verifiedPicks: number;
  hits: number;
  misses: number;
  pushes: number;
  hitRate: number;
  sampleConfidence: 'high' | 'medium' | 'low' | 'insufficient';
  lastUpdated: Date | null;
  grade: string;
  gradeColor: string;
}

export interface UnifiedAccuracyData {
  systems: SystemAccuracy[];
  compositeGrade: string;
  compositeGradeColor: string;
  compositeHitRate: number;
  totalVerified: number;
  isLoading: boolean;
  error: Error | null;
  refetch: () => void;
}

interface RawSystemData {
  system_name: string;
  display_name: string;
  icon: string;
  total_picks: number;
  verified_picks: number;
  hits: number;
  misses: number;
  pushes: number;
  hit_rate: number | null;
  sample_confidence: string;
  last_updated: string | null;
}

export function useUnifiedAccuracy(daysBack: number = 30): UnifiedAccuracyData {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['unified-accuracy', daysBack],
    queryFn: async () => {
      const { data, error } = await supabase
        .rpc('get_unified_system_accuracy', { days_back: daysBack });
      
      if (error) throw error;
      return data as RawSystemData[];
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 30, // 30 minutes
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  });

  const systems: SystemAccuracy[] = (data || []).map((row) => {
    const hitRate = row.hit_rate ?? 0;
    const verifiedPicks = row.verified_picks || 0;
    const { grade, color } = calculateGrade(hitRate, verifiedPicks);
    
    return {
      systemName: row.system_name,
      displayName: row.display_name,
      icon: row.icon,
      totalPicks: row.total_picks || 0,
      verifiedPicks: verifiedPicks,
      hits: row.hits || 0,
      misses: row.misses || 0,
      pushes: row.pushes || 0,
      hitRate: hitRate,
      sampleConfidence: (row.sample_confidence || 'insufficient') as SystemAccuracy['sampleConfidence'],
      lastUpdated: row.last_updated ? new Date(row.last_updated) : null,
      grade,
      gradeColor: color,
    };
  });

  // Calculate composite score (weighted by verified picks)
  let weightedSum = 0;
  let totalWeight = 0;
  let totalVerified = 0;

  systems.forEach((sys) => {
    if (sys.verifiedPicks >= 10) {
      weightedSum += sys.hitRate * sys.verifiedPicks;
      totalWeight += sys.verifiedPicks;
    }
    totalVerified += sys.verifiedPicks;
  });

  const compositeHitRate = totalWeight > 0 
    ? Math.round((weightedSum / totalWeight) * 10) / 10 
    : 0;

  const { grade: compositeGrade, color: compositeGradeColor } = calculateGrade(
    compositeHitRate, 
    totalVerified
  );

  return {
    systems,
    compositeGrade,
    compositeGradeColor,
    compositeHitRate,
    totalVerified,
    isLoading,
    error: error as Error | null,
    refetch,
  };
}
