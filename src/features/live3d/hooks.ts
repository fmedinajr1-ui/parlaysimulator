import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { LiveGameState, PropQuote } from "./types";

export function useLiveGameState(gameId: string | undefined) {
  const [state, setState] = useState<LiveGameState | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!gameId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("live_game_state")
        .select("*")
        .eq("game_id", gameId)
        .maybeSingle();
      if (!cancelled) {
        setState((data as LiveGameState | null) ?? null);
        setLoading(false);
      }
    })();

    const ch = supabase
      .channel(`live_game_state:${gameId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_game_state", filter: `game_id=eq.${gameId}` },
        (payload) => {
          if (payload.new) setState(payload.new as LiveGameState);
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(ch);
    };
  }, [gameId]);

  return { state, loading };
}

export function useLiveGames() {
  const [games, setGames] = useState<LiveGameState[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("live_game_state")
        .select("*")
        .in("status", ["in_progress", "scheduled"])
        .order("commence_time", { ascending: true })
        .limit(100);
      if (!cancelled) {
        setGames((data as LiveGameState[]) ?? []);
        setLoading(false);
      }
    }
    load();
    const id = setInterval(load, 20_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { games, loading };
}

export function usePropQuotes(eventId: string | undefined) {
  const [quotes, setQuotes] = useState<PropQuote[]>([]);
  const [quotaExceeded, setQuotaExceeded] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    async function load() {
      const { data } = await supabase
        .from("live_prop_quotes")
        .select("*")
        .eq("event_id", eventId)
        .order("fetched_at", { ascending: false })
        .limit(2000);
      if (!cancelled) setQuotes((data as PropQuote[]) ?? []);
    }
    load();
    const id = setInterval(load, 15_000);
    const ch = supabase
      .channel(`live_prop_quotes:${eventId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_prop_quotes", filter: `event_id=eq.${eventId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      cancelled = true;
      clearInterval(id);
      supabase.removeChannel(ch);
    };
  }, [eventId]);

  return { quotes, quotaExceeded, setQuotaExceeded };
}