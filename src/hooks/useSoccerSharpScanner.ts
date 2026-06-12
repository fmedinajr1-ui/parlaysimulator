import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SoccerSharpAlert {
  id: string;
  match_id: string;
  home_team: string;
  away_team: string;
  league: string | null;
  market: string;
  line: number | null;
  sportsbook: string;
  recommended_side: string;
  sharp_probability: number;
  sportsbook_probability: number;
  edge_percent: number;
  chess_score: number;
  classification: "LEAN" | "STRONG" | "HAMMER" | "STEAM";
  expected_value: number | null;
  confidence: number | null;
  risk_flags: string[];
  status: string;
  created_at: string;
}

export interface SoccerLineMovement {
  id: string;
  match_id: string;
  sportsbook: string;
  market_type: string;
  side: string;
  opening_line: number | null;
  opening_price: number | null;
  current_line: number | null;
  current_price: number | null;
  previous_line: number | null;
  movement_count: number;
  updated_at: string;
}

export function useSoccerSharpAlerts() {
  return useQuery({
    queryKey: ["soccer-sharp-alerts"],
    queryFn: async (): Promise<SoccerSharpAlert[]> => {
      const { data, error } = await (supabase as any)
        .from("soccer_sharp_alerts")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as SoccerSharpAlert[];
    },
    refetchInterval: 30_000,
  });
}

export function useSoccerLineMovements() {
  return useQuery({
    queryKey: ["soccer-line-movements"],
    queryFn: async (): Promise<SoccerLineMovement[]> => {
      const { data, error } = await (supabase as any)
        .from("soccer_line_movements")
        .select("*")
        .gt("movement_count", 0)
        .order("updated_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SoccerLineMovement[];
    },
    refetchInterval: 30_000,
  });
}

export async function runSoccerSharpIngest() {
  const { data, error } = await supabase.functions.invoke("soccer-sharp-ingest", {});
  if (error) throw error;
  return data;
}