import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getEasternDate } from "@/lib/dateUtils";

export type FadeStatus =
  | "OUT"
  | "DOUBTFUL"
  | "QUESTIONABLE"
  | "GTD"
  | "DAY-TO-DAY"
  | "MINUTES_RISK"
  | "NEWS";

export type FadeSeverity = "critical" | "high" | "medium" | "low";

export interface FadeAngle {
  player: string | null;
  team: string | null;
  sport: string | null;
  status: FadeStatus;
  severity: FadeSeverity;
  detail: string;
  source: "injury_reports" | "lineup_alerts" | "game_news_feed";
  exploit?: {
    kind: "stale_line" | "usage_shift" | "both";
    note: string;
  };
  eventId?: string | null;
}

const TRIGGER_STATUSES: FadeStatus[] = [
  "OUT",
  "DOUBTFUL",
  "QUESTIONABLE",
  "GTD",
  "DAY-TO-DAY",
  "MINUTES_RISK",
];

function normalize(s: string | null | undefined): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function lastName(name: string | null | undefined): string {
  const parts = normalize(name).split(/\s+/);
  return parts[parts.length - 1] || "";
}

function severityFromImpact(level?: string | null, isStar?: boolean): FadeSeverity {
  const l = (level || "").toLowerCase();
  if (l === "critical") return "critical";
  if (l === "high") return "high";
  if (l === "medium") return "medium";
  if (isStar) return "high";
  return "low";
}

/**
 * Aggregates today's injury reports, lineup alerts, and high-impact game news
 * into a single in-memory pool of fade angles. Consumers query the pool by
 * player / team / event_id / free-text description.
 *
 * Only triggers when at least one leg matches an OUT / questionable status OR
 * a market_impact=false news item (stale-line exploit).
 */
export function useFadeAngles() {
  const [angles, setAngles] = useState<FadeAngle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const today = getEasternDate();
      try {
        const [injuriesRes, lineupsRes, newsRes] = await Promise.all([
          supabase
            .from("injury_reports")
            .select("player_name, team_name, sport, status, injury_type, injury_detail, impact_score, is_star_player, event_id")
            .eq("game_date", today),
          supabase
            .from("lineup_alerts")
            .select("player_name, team, alert_type, injury_note, impact_level, event_id, details")
            .eq("game_date", today),
          supabase
            .from("game_news_feed")
            .select("player_name, home_team, away_team, sport, news_type, headline, impact_level, market_impact, event_id, expires_at")
            .gte("commence_time", new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString()),
        ]);

        const out: FadeAngle[] = [];

        for (const r of injuriesRes.data || []) {
          const status = String(r.status || "").toUpperCase();
          if (!TRIGGER_STATUSES.includes(status as FadeStatus)) continue;
          out.push({
            player: r.player_name,
            team: r.team_name,
            sport: r.sport,
            status: status as FadeStatus,
            severity: severityFromImpact(
              (r.impact_score ?? 0) >= 7 ? "high" : (r.impact_score ?? 0) >= 4 ? "medium" : "low",
              !!r.is_star_player,
            ),
            detail: [r.injury_type, r.injury_detail].filter(Boolean).join(": ") || "Injury report",
            source: "injury_reports",
            eventId: r.event_id,
          });
        }

        for (const r of lineupsRes.data || []) {
          const t = String(r.alert_type || "").toUpperCase();
          if (!TRIGGER_STATUSES.includes(t as FadeStatus)) continue;
          out.push({
            player: r.player_name,
            team: r.team,
            sport: null,
            status: t as FadeStatus,
            severity: severityFromImpact(r.impact_level),
            detail: r.injury_note || r.details || "Lineup alert",
            source: "lineup_alerts",
            eventId: r.event_id,
          });
        }

        for (const r of newsRes.data || []) {
          const isExploit = r.market_impact === false;
          const impactGate = ["high", "critical"].includes(String(r.impact_level));
          if (!isExploit && !impactGate) continue;
          out.push({
            player: r.player_name,
            team: r.home_team, // news doesn't disambiguate, store home; matching also checks away below
            sport: r.sport,
            status: "NEWS",
            severity: severityFromImpact(r.impact_level),
            detail: r.headline || "Market news",
            source: "game_news_feed",
            eventId: r.event_id,
            exploit: isExploit
              ? { kind: "stale_line", note: "Line hasn't moved on this news" }
              : undefined,
          });
          // duplicate for away side so team-matching catches both
          if (r.away_team) {
            out.push({
              player: r.player_name,
              team: r.away_team,
              sport: r.sport,
              status: "NEWS",
              severity: severityFromImpact(r.impact_level),
              detail: r.headline || "Market news",
              source: "game_news_feed",
              eventId: r.event_id,
              exploit: isExploit
                ? { kind: "stale_line", note: "Line hasn't moved on this news" }
                : undefined,
            });
          }
        }

        // Tag usage-shift exploits: any team with an OUT player triggers a
        // teammate-usage-shift opportunity on every other angle on the same team.
        const outTeams = new Set(
          out.filter((a) => a.status === "OUT" && a.team).map((a) => normalize(a.team!)),
        );
        for (const a of out) {
          if (!a.team) continue;
          if (outTeams.has(normalize(a.team)) && a.status !== "OUT") {
            const prev = a.exploit?.kind;
            a.exploit = {
              kind: prev === "stale_line" ? "both" : "usage_shift",
              note:
                prev === "stale_line"
                  ? "Stale line + teammate OUT usage shift"
                  : "Teammate OUT → usage shift opportunity",
            };
          }
        }

        if (!cancelled) setAngles(out);
      } catch (e) {
        console.error("[useFadeAngles] load failed", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const api = useMemo(() => {
    const byPlayer = (name?: string | null): FadeAngle[] => {
      if (!name) return [];
      const n = normalize(name);
      const last = lastName(name);
      return angles.filter((a) => {
        if (!a.player) return false;
        const p = normalize(a.player);
        return p === n || p.includes(n) || n.includes(p) || (last && p.endsWith(last));
      });
    };
    const byTeam = (team?: string | null): FadeAngle[] => {
      if (!team) return [];
      const t = normalize(team);
      return angles.filter((a) => a.team && (normalize(a.team) === t || normalize(a.team).includes(t) || t.includes(normalize(a.team))));
    };
    const byEvent = (eventId?: string | null): FadeAngle[] => {
      if (!eventId) return [];
      return angles.filter((a) => a.eventId === eventId);
    };
    const byDescription = (description?: string | null): FadeAngle[] => {
      if (!description) return [];
      const d = normalize(description);
      return angles.filter((a) => {
        if (a.player && d.includes(normalize(a.player))) return true;
        if (a.player && d.includes(lastName(a.player)) && lastName(a.player).length >= 4) return true;
        if (a.team && d.includes(normalize(a.team))) return true;
        return false;
      });
    };
    return { byPlayer, byTeam, byEvent, byDescription };
  }, [angles]);

  return { angles, loading, ...api };
}

/** Pick the single most severe angle from a list (UI badge collapses to one). */
export function pickTopFadeAngle(list: FadeAngle[]): FadeAngle | null {
  if (!list || list.length === 0) return null;
  const sevRank: Record<FadeSeverity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  const statusRank: Record<string, number> = {
    OUT: 5,
    DOUBTFUL: 4,
    QUESTIONABLE: 3,
    GTD: 3,
    "DAY-TO-DAY": 2,
    MINUTES_RISK: 2,
    NEWS: 1,
  };
  return [...list].sort((a, b) => {
    const s = (sevRank[b.severity] || 0) - (sevRank[a.severity] || 0);
    if (s !== 0) return s;
    return (statusRank[b.status] || 0) - (statusRank[a.status] || 0);
  })[0];
}