import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

const MIN_RISK_ROWS = 8;
const FRESH_ODDS_WINDOW_MINUTES = 120;
const STALE_RISK_WINDOW_MINUTES = 360;
const BOOKMAKER_PRIORITY = ["fanduel", "draftkings", "betmgm"];

type RiskRow = {
  player_name: string | null;
  prop_type: string | null;
  side: string | null;
  line: number | null;
  rejection_reason: string | null;
  created_at: string | null;
};

type SweetSpotRow = {
  player_name: string | null;
  prop_type: string | null;
  recommended_side: string | null;
  recommended_line: number | null;
  created_at: string | null;
};

type PropRow = {
  player_name: string | null;
  prop_type: string | null;
  bookmaker: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  is_active: boolean | null;
  odds_updated_at: string | null;
  updated_at: string | null;
  commence_time: string | null;
};

type OutputRow = {
  created_at: string;
};

interface DiagnosticReason {
  label: string;
  count: number;
  status: "good" | "warn" | "bad";
}

interface SimulationCoverageDiagnostics {
  targetDate: string;
  blockCode: string;
  threshold: {
    minRiskRows: number;
    freshOddsWindowMinutes: number;
    staleRiskWindowMinutes: number;
  };
  summary: {
    approvedRiskRows: number;
    freshRiskRows: number;
    staleRiskRows: number;
    fallbackRows: number;
    oddsRows: number;
    freshOddsRows: number;
    freshMatchedRows: number;
    outputsToday: number;
    readiness: "ready" | "thin" | "blocked";
  };
  upstream: {
    latestOddsUpdateAt: string | null;
    latestRiskUpdateAt: string | null;
    latestSweetSpotUpdateAt: string | null;
    staleSourceCounts: {
      staleRiskRows: number;
      staleOddsRows: number;
      emptySweetSpots: number;
    };
    stages: Array<{
      key: string;
      label: string;
      status: "good" | "warn" | "bad";
      detail: string;
    }>;
  };
  reasons: DiagnosticReason[];
  coverage: {
    riskProgressPct: number;
    matchProgressPct: number;
  };
  lastUpdatedAt: string;
}

function normalizeName(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeProp(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function normalizeSide(value: string | null | undefined) {
  const side = (value || "").trim().toLowerCase();
  return side === "over" || side === "under" ? side : null;
}

function buildKey(playerName: string | null | undefined, propType: string | null | undefined) {
  return `${normalizeName(playerName)}|${normalizeProp(propType)}`;
}

function ageMinutes(timestamp: string | null | undefined, now = Date.now()) {
  if (!timestamp) return Number.POSITIVE_INFINITY;
  const time = new Date(timestamp).getTime();
  if (Number.isNaN(time)) return Number.POSITIVE_INFINITY;
  return (now - time) / 60000;
}

function getQueryWindowForEasternDate(easternDate: string) {
  const nextDay = new Date(`${easternDate}T00:00:00Z`);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);
  const nextDayString = nextDay.toISOString().slice(0, 10);

  return {
    startUTC: `${easternDate}T00:00:00Z`,
    endUTC: `${nextDayString}T12:00:00Z`,
  };
}

function pickPreferredBook(rows: PropRow[]) {
  for (const book of BOOKMAKER_PRIORITY) {
    const match = rows.find((row) => (row.bookmaker || "").toLowerCase() === book && row.is_active !== false);
    if (match) return match;
  }

  return rows.find((row) => row.is_active !== false) || rows[0] || null;
}

export function useSimulationCoverageDiagnostics() {
  return useQuery({
    queryKey: ["simulation-coverage-diagnostics", getEasternDate()],
    queryFn: async (): Promise<SimulationCoverageDiagnostics> => {
      const targetDate = getEasternDate();
      const { startUTC, endUTC } = getQueryWindowForEasternDate(targetDate);

      const [riskRes, sweetRes, propsRes, outputsRes] = await Promise.all([
        supabase
          .from("nba_risk_engine_picks")
          .select("player_name, prop_type, side, line, rejection_reason, created_at")
          .eq("game_date", targetDate)
          .eq("mode", "full_slate"),
        supabase
          .from("category_sweet_spots")
          .select("player_name, prop_type, recommended_side, recommended_line, created_at")
          .eq("analysis_date", targetDate)
          .eq("is_active", true),
        supabase
          .from("unified_props")
          .select("player_name, prop_type, bookmaker, current_line, over_price, under_price, is_active, odds_updated_at, updated_at, commence_time")
          .gte("commence_time", startUTC)
          .lt("commence_time", endUTC),
        supabase
          .from("simulation_shadow_picks")
          .select("created_at")
          .gte("created_at", startUTC)
          .lt("created_at", endUTC),
      ]);

      if (riskRes.error) throw riskRes.error;
      if (sweetRes.error) throw sweetRes.error;
      if (propsRes.error) throw propsRes.error;
      if (outputsRes.error) throw outputsRes.error;

      const now = Date.now();
      const riskRows = ((riskRes.data || []) as RiskRow[]).filter((row) => !row.rejection_reason);
      const freshRiskRows = riskRows.filter((row) => ageMinutes(row.created_at, now) <= STALE_RISK_WINDOW_MINUTES);
      const staleRiskRows = riskRows.length - freshRiskRows.length;
      const fallbackRows = ((sweetRes.data || []) as SweetSpotRow[]).length;
      const sweetSpotRows = (sweetRes.data || []) as SweetSpotRow[];
      const outputRows = (outputsRes.data || []) as OutputRow[];
      const propRows = (propsRes.data || []) as PropRow[];

      const latestOddsUpdateAt = propRows.reduce<string | null>((latest, row) => {
        const candidate = row.odds_updated_at || row.updated_at || null;
        if (!candidate) return latest;
        if (!latest) return candidate;
        return new Date(candidate).getTime() > new Date(latest).getTime() ? candidate : latest;
      }, null);

      const latestRiskUpdateAt = riskRows.reduce<string | null>((latest, row) => {
        if (!row.created_at) return latest;
        if (!latest) return row.created_at;
        return new Date(row.created_at).getTime() > new Date(latest).getTime() ? row.created_at : latest;
      }, null);
      const latestSweetSpotUpdateAt = sweetSpotRows.reduce<string | null>((latest, row) => {
        if (!row.created_at) return latest;
        if (!latest) return row.created_at;
        return new Date(row.created_at).getTime() > new Date(latest).getTime() ? row.created_at : latest;
      }, null);

      const freshOddsRows = propRows.filter((row) => {
        const updatedAt = row.odds_updated_at || row.updated_at;
        return row.is_active !== false && ageMinutes(updatedAt, now) <= FRESH_ODDS_WINDOW_MINUTES;
      }).length;
      const staleOddsRows = propRows.length - freshOddsRows;

      const propsByKey = new Map<string, PropRow[]>();
      for (const row of propRows) {
        const key = buildKey(row.player_name, row.prop_type);
        const bucket = propsByKey.get(key) || [];
        bucket.push(row);
        propsByKey.set(key, bucket);
      }

      let noMatchOdds = 0;
      let staleOdds = 0;
      let missingPrice = 0;
      let lineMoved = 0;
      let freshMatchedRows = 0;

      for (const riskRow of freshRiskRows) {
        const side = normalizeSide(riskRow.side);
        const matchedRows = propsByKey.get(buildKey(riskRow.player_name, riskRow.prop_type)) || [];
        const matched = pickPreferredBook(matchedRows);

        if (!matched) {
          noMatchOdds += 1;
          continue;
        }

        const updatedAt = matched.odds_updated_at || matched.updated_at;
        const oddsAge = ageMinutes(updatedAt, now);
        const selectedPrice = side === "over" ? matched.over_price : side === "under" ? matched.under_price : null;
        const lineDrift = matched.current_line != null && riskRow.line != null
          ? Math.abs(Number(matched.current_line) - Number(riskRow.line))
          : 0;

        if (matched.is_active === false || oddsAge > FRESH_ODDS_WINDOW_MINUTES) {
          staleOdds += 1;
        } else if (selectedPrice == null) {
          missingPrice += 1;
        } else if (lineDrift > 0.5) {
          lineMoved += 1;
        } else {
          freshMatchedRows += 1;
        }
      }

      const reasons: DiagnosticReason[] = [
        {
          label: freshRiskRows.length >= MIN_RISK_ROWS ? "Risk coverage at threshold" : `Need ${Math.max(MIN_RISK_ROWS - freshRiskRows.length, 0)} more fresh risk rows`,
          count: freshRiskRows.length,
          status: freshRiskRows.length >= MIN_RISK_ROWS ? "good" : freshRiskRows.length > 0 ? "warn" : "bad",
        },
        { label: "Stale risk rows", count: staleRiskRows, status: staleRiskRows > 0 ? "warn" : "good" },
        { label: "No-match odds", count: noMatchOdds, status: noMatchOdds > 0 ? "bad" : "good" },
        { label: "Stale odds rows", count: staleOdds, status: staleOdds > 0 ? "bad" : "good" },
        { label: "Missing side price", count: missingPrice, status: missingPrice > 0 ? "warn" : "good" },
        { label: "Line moved > 0.5", count: lineMoved, status: lineMoved > 0 ? "warn" : "good" },
        { label: "Fallback sweet spots", count: fallbackRows, status: fallbackRows > 0 ? "good" : "warn" },
      ];

      const readiness = freshMatchedRows >= MIN_RISK_ROWS
        ? "ready"
        : freshRiskRows.length >= MIN_RISK_ROWS || fallbackRows > 0
          ? "thin"
          : "blocked";

      const blockCode = freshOddsRows === 0
        ? (propRows.length === 0 ? "blocked:no_props_for_today" : "blocked:stale_odds")
        : freshRiskRows.length === 0
          ? "blocked:risk_empty"
          : freshRiskRows.length < MIN_RISK_ROWS
            ? "blocked:risk_thin"
            : fallbackRows === 0
              ? "blocked:sweet_spots_empty"
              : freshMatchedRows === 0
                ? "blocked:no_usable_matches"
                : "ready";

      const stages = [
        {
          key: "odds",
          label: "Odds ingest",
          status: freshOddsRows > 0 ? "good" : propRows.length > 0 ? "warn" : "bad",
          detail: freshOddsRows > 0 ? `${freshOddsRows} fresh rows in window` : propRows.length > 0 ? "rows exist but freshness gate failed" : "no live props for today",
        },
        {
          key: "risk",
          label: "Risk engine",
          status: freshRiskRows.length >= MIN_RISK_ROWS ? "good" : freshRiskRows.length > 0 ? "warn" : "bad",
          detail: freshRiskRows.length > 0 ? `${freshRiskRows.length}/${MIN_RISK_ROWS} fresh approved rows` : "no fresh approved risk rows",
        },
        {
          key: "fallback",
          label: "Sweet-spot fallback",
          status: fallbackRows > 0 ? "good" : "warn",
          detail: fallbackRows > 0 ? `${fallbackRows} active fallback rows` : "fallback source empty or not needed",
        },
        {
          key: "matching",
          label: "Book matching",
          status: freshMatchedRows >= MIN_RISK_ROWS ? "good" : freshMatchedRows > 0 ? "warn" : "bad",
          detail: freshMatchedRows > 0 ? `${freshMatchedRows} legs survived freshness and drift checks` : "no usable matched legs",
        },
      ] as const;

      return {
        targetDate,
        blockCode,
        threshold: {
          minRiskRows: MIN_RISK_ROWS,
          freshOddsWindowMinutes: FRESH_ODDS_WINDOW_MINUTES,
          staleRiskWindowMinutes: STALE_RISK_WINDOW_MINUTES,
        },
        summary: {
          approvedRiskRows: riskRows.length,
          freshRiskRows: freshRiskRows.length,
          staleRiskRows,
          fallbackRows,
          oddsRows: propRows.length,
          freshOddsRows,
          freshMatchedRows,
          outputsToday: outputRows.length,
          readiness,
        },
        upstream: {
          latestOddsUpdateAt,
          latestRiskUpdateAt,
          latestSweetSpotUpdateAt,
          staleSourceCounts: {
            staleRiskRows,
            staleOddsRows,
            emptySweetSpots: fallbackRows === 0 ? 1 : 0,
          },
          stages: [...stages],
        },
        reasons,
        coverage: {
          riskProgressPct: Math.min((freshRiskRows.length / MIN_RISK_ROWS) * 100, 100),
          matchProgressPct: Math.min((freshMatchedRows / MIN_RISK_ROWS) * 100, 100),
        },
        lastUpdatedAt: new Date().toISOString(),
      };
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
  });
}