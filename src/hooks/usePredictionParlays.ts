import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface PredictionPick {
  id: string;
  player_name: string;
  prop_type: string;
  sport: string;
  prediction: string;
  signal_type: string;
  confidence_at_signal: number;
  edge_at_signal: number;
  event_id: string;
  created_at: string;
  signal_accuracy: number;
  signal_sample_size: number;
}

export interface PredictionParlay {
  id: string;
  leg1: PredictionPick;
  leg2: PredictionPick;
  combined_accuracy: number;
  combined_confidence: number;
  sports: string[];
  strategy: string;
}

interface SignalStat {
  signal_type: string;
  accuracy: number;
  sample_size: number;
}

export function usePredictionParlays() {
  const [parlays, setParlays] = useState<PredictionParlay[]>([]);
  const [signalStats, setSignalStats] = useState<SignalStat[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchParlays = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const { data, error: fnError } = await supabase.functions.invoke("generate-prediction-parlays");
      if (fnError) throw fnError;

      if (data?.success) {
        setParlays(data.parlays || []);
        setSignalStats(data.signal_stats || []);
      } else {
        setError(data?.reason || "Failed to generate");
        setParlays([]);
      }
    } catch (err: any) {
      console.error("Error fetching prediction parlays:", err);
      setError(err.message);
      setParlays([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchParlays();
  }, []);

  return { parlays, signalStats, isLoading, error, refresh: fetchParlays };
}
