import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

export interface DiagnosticsOption {
  label: string;
  count: number;
}

export interface DiagnosticsRow {
  [key: string]: unknown;
}

export interface BotLegDiagnosticsResponse {
  success: boolean;
  target_date: string;
  source_health?: {
    risk_source_rows: number;
    fallback_source_rows: number;
    source_status: string;
    sweet_spot_rows_active: number;
  };
  filters: {
    bookmaker: string | null;
    player_search: string | null;
    failed_only: boolean;
  };
  summary: {
    risk_rows_total: number;
    risk_rows_approved: number;
    risk_rows_rejected: number;
    pool_rows_total: number;
    pool_rows_ready: boolean;
    pool_rows_failing: number;
    matched_fresh_rows: number;
    pending_parlays: number;
    pending_straight_bets: number;
    final_reason: string | null;
    primary_blocker: string | null;
    scanning_books: boolean;
    scanned_bookmakers: Array<{
      bookmaker: string;
      count: number;
      fresh_count_2h: number;
      latest_seen_at: string | null;
    }>;
  };
  engine_start: {
    engine_name: string;
    approved_count: number;
    rejected_count: number;
    top_rejection_reasons: DiagnosticsOption[];
    approved_rows: DiagnosticsRow[];
    rejected_rows: DiagnosticsRow[];
  };
  pick_pool: {
    status: string;
    total_rows: number;
    failed_rows: number;
    blocker_breakdown: DiagnosticsOption[];
    rows: DiagnosticsRow[];
    diagnostics?: DiagnosticsRow;
  };
  book_scan: {
    total_rows: number;
    fresh_rows_2h: number;
    stale_rows: number;
    fanduel_rows_2h: number;
    by_bookmaker: Array<{
      bookmaker: string;
      count: number;
      fresh_count_2h: number;
      latest_seen_at: string | null;
    }>;
    matched_pool_candidates: number;
    unmatched_pool_candidates: number;
    latest_rows: DiagnosticsRow[];
  };
  generation_blockers: {
    stale_threshold_minutes: number;
    fresh_window_minutes: number;
    line_drift_threshold: number;
    blocker_breakdown: DiagnosticsOption[];
    diagnostics: Record<string, boolean>;
  };
  outputs: {
    parlays: DiagnosticsRow[];
    straight_bets: DiagnosticsRow[];
  };
}

export function useBotLegDiagnostics() {
  const [date, setDate] = useState(getEasternDate());
  const [bookmaker, setBookmaker] = useState<string>("all");
  const [playerSearch, setPlayerSearch] = useState("");
  const [failedOnly, setFailedOnly] = useState(false);

  const query = useQuery({
    queryKey: ["bot-leg-diagnostics", date, bookmaker, playerSearch, failedOnly],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("bot-leg-production-diagnostics", {
        body: {
          date,
          bookmaker: bookmaker === "all" ? null : bookmaker,
          player_search: playerSearch.trim() || null,
          failed_only: failedOnly,
        },
      });

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || "Diagnostics request failed");
      }

      return data as BotLegDiagnosticsResponse;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const bookmakerOptions = useMemo(() => {
    const options = query.data?.summary.scanned_bookmakers ?? [];
    return [
      { value: "all", label: "All books" },
      ...options.map((book) => ({ value: book.bookmaker, label: `${book.bookmaker} (${book.count})` })),
    ];
  }, [query.data]);

  return {
    date,
    setDate,
    bookmaker,
    setBookmaker,
    playerSearch,
    setPlayerSearch,
    failedOnly,
    setFailedOnly,
    bookmakerOptions,
    data: query.data,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    error: query.error,
    refetch: query.refetch,
  };
}