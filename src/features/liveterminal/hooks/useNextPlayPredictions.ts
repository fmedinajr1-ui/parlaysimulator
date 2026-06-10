import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export type NextPlayPrediction = {
  id: string;
  event_id: string;
  player_name: string;
  prop_type: string;
  prop_label: string;
  line: number;
  side: "Over" | "Under";
  book: string | null;
  american_price: number | null;
  prob_next_play: number;
  edge_pct: number | null;
  rationale: string | null;
  created_at: string;
};

export function useNextPlayPredictions(eventId: string | undefined) {
  const [predictions, setPredictions] = useState<NextPlayPrediction[]>([]);
  const [lastRun, setLastRun] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;

    async function load() {
      try {
        const { data, error } = await supabase
          .from("live_next_play_predictions")
          .select("*")
          .eq("event_id", eventId)
          .gt("expires_at", new Date().toISOString())
          .order("prob_next_play", { ascending: false })
          .limit(10);
        if (error) throw error;
        if (!cancelled) setPredictions((data ?? []) as NextPlayPrediction[]);
      } catch (err) {
        console.error("[useNextPlayPredictions] load failed", err);
      }
    }

    async function trigger() {
      if (cancelled) return;
      setLoading(true);
      try {
        await supabase.functions.invoke("live-next-play-predictor", {
          body: { event_id: eventId },
        });
        setLastRun(Date.now());
        await load();
      } catch (err) {
        console.error("[useNextPlayPredictions] trigger failed", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    trigger();
    const id = setInterval(trigger, 20_000);

    const ch = supabase
      .channel(`live_next_play_predictions:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_next_play_predictions",
          filter: `event_id=eq.${eventId}`,
        },
        () => load(),
      )
      .subscribe();
    channelRef.current = ch;

    return () => {
      cancelled = true;
      clearInterval(id);
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [eventId]);

  return { predictions, lastRun, loading };
}