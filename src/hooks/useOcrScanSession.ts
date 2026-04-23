import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

export type OcrScannedProp = {
  id: string;
  session_id: string;
  player_name: string;
  prop_type: string;
  side: "over" | "under";
  line: number;
  over_price: number | null;
  under_price: number | null;
  dna_score: number | null;
  composite_score: number | null;
  l10_hit_rate: number | null;
  l10_avg: number | null;
  blocked: boolean;
  block_reason: string | null;
  selected_for_parlay: boolean;
  source_channel: string;
  correlation_tags: string[] | null;
  market_price_delta: number | null;
  created_at: string;
};

export type OcrScanSession = {
  id: string;
  user_id: string;
  sport: string;
  book: string;
  capture_mode: string;
  status: string;
  created_at: string;
};

export function useOcrScanSession() {
  const [session, setSession] = useState<OcrScanSession | null>(null);
  const [props, setProps] = useState<OcrScannedProp[]>([]);
  const [loading, setLoading] = useState(false);

  const startSession = useCallback(async (sport: string, book: string, capture_mode: string) => {
    setLoading(true);
    const { data: userRes } = await supabase.auth.getUser();
    const user_id = userRes.user?.id;
    if (!user_id) { setLoading(false); throw new Error("Sign in required"); }
    await supabase.from("ocr_scan_sessions")
      .update({ status: "archived" })
      .eq("user_id", user_id).eq("status", "active");
    const { data, error } = await supabase
      .from("ocr_scan_sessions")
      .insert({ user_id, sport, book, capture_mode })
      .select("*").single();
    setLoading(false);
    if (error) throw error;
    setSession(data as any);
    setProps([]);
    return data as any;
  }, []);

  const finalizeSession = useCallback(async () => {
    if (!session) return;
    await supabase.from("ocr_scan_sessions")
      .update({ status: "finalized", finalized_at: new Date().toISOString() })
      .eq("id", session.id);
    setSession(null);
    setProps([]);
  }, [session]);

  const toggleSelected = useCallback(async (id: string, selected: boolean) => {
    setProps(prev => prev.map(p => p.id === id ? { ...p, selected_for_parlay: selected } : p));
    await supabase.from("ocr_scanned_props")
      .update({ selected_for_parlay: selected }).eq("id", id);
  }, []);

  // realtime subscription
  useEffect(() => {
    if (!session) return;
    supabase.from("ocr_scanned_props").select("*")
      .eq("session_id", session.id)
      .order("composite_score", { ascending: false })
      .then(({ data }) => setProps((data ?? []) as any));
    const channel = supabase.channel(`ocr-scan-${session.id}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "ocr_scanned_props", filter: `session_id=eq.${session.id}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setProps(prev => [payload.new as any, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setProps(prev => prev.map(p => p.id === (payload.new as any).id ? payload.new as any : p));
          } else if (payload.eventType === "DELETE") {
            setProps(prev => prev.filter(p => p.id !== (payload.old as any).id));
          }
        })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [session?.id]);

  return { session, props, loading, startSession, finalizeSession, toggleSelected };
}

export async function uploadFramesForOcr(args: {
  session_id: string; frames: string[]; book: string; sport: string;
}) {
  const { data, error } = await supabase.functions.invoke("ocr-prop-scan", {
    body: { ...args, source_channel: "web" },
  });
  if (error) throw error;
  return data;
}

export async function buildParlaysFromPool(args: {
  session_id: string; target_legs?: number; mode?: "auto" | "manual"; selected_prop_ids?: string[];
}) {
  const { data, error } = await supabase.functions.invoke("ocr-pool-build-parlays", {
    body: { mode: "auto", target_legs: 3, ...args },
  });
  if (error) throw error;
  return data;
}