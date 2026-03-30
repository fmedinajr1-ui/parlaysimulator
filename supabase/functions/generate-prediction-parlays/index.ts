import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const log = (msg: string) => console.log(`[prediction-parlays] ${msg}`);

  try {
    log("=== Generating 2-Leg Prediction Parlays from PERFECT/STRONG Signals ===");

    const now = new Date();
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // 1. Get today's PERFECT and STRONG signals
    const { data: todaySignals, error: sigErr } = await supabase
      .from("fanduel_prediction_accuracy")
      .select("*")
      .gte("created_at", todayStart.toISOString())
      .is("was_correct", null)
      .in("signal_type", ["PERFECT", "STRONG"])
      .not("player_name", "is", null)
      .order("edge_at_signal", { ascending: false });

    if (sigErr) {
      log(`Error fetching signals: ${sigErr.message}`);
      throw sigErr;
    }

    if (!todaySignals || todaySignals.length < 2) {
      log(`Only ${todaySignals?.length || 0} PERFECT/STRONG signals today — need ≥2`);
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough PERFECT/STRONG signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    log(`Found ${todaySignals.length} PERFECT/STRONG signals today`);

    // 2. Cross-reference against unified_props for verified FanDuel lines
    const { data: verifiedProps } = await supabase
      .from("unified_props")
      .select("player_name, prop_type, line, has_real_line")
      .eq("has_real_line", true);

    const verifiedLineKeys = new Set<string>();
    if (verifiedProps) {
      for (const vp of verifiedProps) {
        const key = `${(vp.player_name || "").toLowerCase().trim()}|${(vp.prop_type || "").toLowerCase().trim()}`;
        verifiedLineKeys.add(key);
      }
    }
    log(`Verified FanDuel lines: ${verifiedLineKeys.size}`);

    // Filter to only verified lines
    const verified = todaySignals.filter(p => {
      const key = `${(p.player_name || "").toLowerCase().trim()}|${(p.prop_type || "").toLowerCase().trim()}`;
      return verifiedLineKeys.has(key);
    });

    log(`After FanDuel verification: ${verified.length}/${todaySignals.length}`);

    if (verified.length < 2) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "Not enough verified signals" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3. Enrich and score picks
    interface EnrichedPick {
      id: string;
      player_name: string;
      prop_type: string;
      sport: string;
      prediction: string;
      signal_type: string; // PERFECT or STRONG
      confidence: number;
      edge: number;
      event_id: string;
      score: number;
      // Rich data from signal_factors
      opponent: string;
      avg_stat: number | null;
      hit_rate: number | null;
      games_played: number | null;
      min_stat: number | null;
      max_stat: number | null;
      floor_gap: number | null;
      over_price: number | null;
      under_price: number | null;
      market_type: string;
      team_record: string;
      ppg: number | null;
      oppg: number | null;
      line: number | null;
    }

    const picks: EnrichedPick[] = verified.map(p => {
      const sf = (p.signal_factors || {}) as Record<string, any>;
      const tierBonus = p.signal_type === "PERFECT" ? 1.5 : 1.0;
      const edge = p.edge_at_signal || 0;
      const hitRate = sf.hit_rate || sf.over_rate || sf.under_rate || 0.5;
      const score = tierBonus * edge * hitRate * 100;

      return {
        id: p.id,
        player_name: p.player_name || "Unknown",
        prop_type: p.prop_type || "",
        sport: p.sport || "",
        prediction: p.prediction || "",
        signal_type: p.signal_type,
        confidence: p.confidence_at_signal || 50,
        edge,
        event_id: p.event_id || "",
        score,
        opponent: sf.opponent || sf.opp || "",
        avg_stat: sf.avg_stat ?? sf.l10_avg ?? null,
        hit_rate: sf.hit_rate ?? sf.over_rate ?? sf.under_rate ?? null,
        games_played: sf.games_played ?? sf.sample_size ?? null,
        min_stat: sf.min_stat ?? sf.floor ?? null,
        max_stat: sf.max_stat ?? sf.ceiling ?? null,
        floor_gap: sf.floor_gap ?? null,
        over_price: sf.over_price ?? null,
        under_price: sf.under_price ?? null,
        market_type: sf.market_type || "player_prop",
        team_record: sf.team_record || "",
        ppg: sf.ppg ?? null,
        oppg: sf.oppg ?? null,
        line: sf.line ?? sf.fanduel_line ?? null,
      };
    });

    // Sort by composite score
    picks.sort((a, b) => b.score - a.score);

    // 4. Build 2-leg parlays: different events, different players
    interface TwoLegParlay {
      leg1: EnrichedPick;
      leg2: EnrichedPick;
      combined_edge: number;
      strategy: string;
    }

    const parlays: TwoLegParlay[] = [];
    const usedIds = new Set<string>();

    const tryPair = (strategy: string, crossSportOnly: boolean, maxParlays: number) => {
      for (let i = 0; i < picks.length && parlays.length < maxParlays; i++) {
        if (usedIds.has(picks[i].id)) continue;
        for (let j = i + 1; j < picks.length && parlays.length < maxParlays; j++) {
          if (usedIds.has(picks[j].id)) continue;
          const a = picks[i], b = picks[j];
          if (a.event_id && b.event_id && a.event_id === b.event_id) continue;
          if (a.player_name === b.player_name) continue;
          if (crossSportOnly && a.sport === b.sport) continue;

          parlays.push({
            leg1: a,
            leg2: b,
            combined_edge: (a.edge + b.edge) / 2,
            strategy,
          });
          usedIds.add(a.id);
          usedIds.add(b.id);
          break;
        }
      }
    };

    tryPair("Cross-Sport", true, 3);
    tryPair("Same-Sport", false, 5);
    parlays.sort((a, b) => b.combined_edge - a.combined_edge);

    log(`Built ${parlays.length} 2-leg prediction parlays`);

    if (parlays.length === 0) {
      return new Response(JSON.stringify({ success: true, parlays: 0, reason: "No valid pairs" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 5. Build rich Telegram digest
    const SPORT_EMOJI: Record<string, string> = {
      NBA: "🏀", MLB: "⚾", NHL: "🏒", NCAAB: "🏀", NFL: "🏈",
    };
    const TIER_EMOJI: Record<string, string> = {
      PERFECT: "🎯", STRONG: "🔵",
    };

    const formatProp = (pt: string) =>
      pt.replace(/_/g, " ").replace(/player /i, "").replace(/\b\w/g, c => c.toUpperCase());

    const formatOdds = (price: number | null) => {
      if (price == null) return "";
      return price > 0 ? `+${price}` : `${price}`;
    };

    const formatLeg = (leg: EnrichedPick): string[] => {
      const lines: string[] = [];
      const tierEmoji = TIER_EMOJI[leg.signal_type] || "🎯";
      const sportEmoji = SPORT_EMOJI[leg.sport] || "🎯";
      const tierLabel = leg.signal_type === "PERFECT" ? "PERFECT LINE" : "STRONG EDGE";
      const propLabel = formatProp(leg.prop_type);
      const isTeamMarket = ["moneyline", "spreads", "totals"].some(m => leg.market_type?.toLowerCase().includes(m));

      // Determine side and odds
      const predLower = (leg.prediction || "").toLowerCase();
      const isOver = predLower.includes("over");
      const sideOdds = isOver ? leg.over_price : leg.under_price;
      const oddsStr = formatOdds(sideOdds);

      lines.push(`${tierEmoji} *${tierLabel}* ${sportEmoji}`);
      lines.push(`*${leg.player_name}* ${leg.prediction} ${propLabel}${oddsStr ? ` (${oddsStr})` : ""}`);

      if (leg.line != null) {
        const lineOdds = isOver ? formatOdds(leg.over_price) : formatOdds(leg.under_price);
        lines.push(`📗 FanDuel Line: ${leg.line}${lineOdds ? ` (${lineOdds})` : ""}`);
      }

      if (isTeamMarket) {
        // Team market format
        if (leg.ppg != null || leg.oppg != null) {
          const parts: string[] = [];
          if (leg.ppg != null) parts.push(`PPG: ${leg.ppg.toFixed(1)}`);
          if (leg.oppg != null) parts.push(`OPPG: ${leg.oppg.toFixed(1)}`);
          if (leg.team_record) parts.push(leg.team_record);
          lines.push(`📊 ${parts.join(" · ")}`);
        }
      } else {
        // Player prop format
        if (leg.opponent || leg.avg_stat != null) {
          const parts: string[] = [];
          if (leg.opponent) parts.push(`vs ${leg.opponent}`);
          if (leg.avg_stat != null) parts.push(`${leg.avg_stat.toFixed(1)} avg`);
          if (leg.min_stat != null && leg.max_stat != null) {
            parts.push(`Floor: ${leg.min_stat} / Ceiling: ${leg.max_stat}`);
          }
          lines.push(`📊 ${parts.join(" · ")}`);
        }
      }

      if (leg.hit_rate != null && leg.games_played != null) {
        const pct = (leg.hit_rate * 100).toFixed(0);
        const hits = Math.round(leg.hit_rate * leg.games_played);
        lines.push(`🔥 Historical: ${pct}% hit rate (${hits}/${leg.games_played} games)`);
      }

      if (leg.edge > 0) {
        lines.push(`✅ Edge: ${(leg.edge * 100).toFixed(1)}% ${isOver ? "above" : "below"} line`);
      }

      if (leg.floor_gap != null && leg.floor_gap > 0) {
        lines.push(`🛡 Floor Gap: +${leg.floor_gap.toFixed(1)} above line`);
      }

      return lines;
    };

    const msgLines: string[] = [
      `🎯 *2-Leg Prediction Parlays*`,
      `${parlays.length} pair(s) from PERFECT/STRONG FanDuel signals`,
      "",
    ];

    for (let i = 0; i < parlays.length; i++) {
      const p = parlays[i];

      msgLines.push(`━━━ *Pair ${i + 1}* — ${p.strategy} ━━━`);
      msgLines.push("");

      // Leg 1
      msgLines.push(...formatLeg(p.leg1));
      msgLines.push("");

      // Leg 2
      msgLines.push(...formatLeg(p.leg2));
      msgLines.push("");

      msgLines.push(`Combined Edge: *${(p.combined_edge * 100).toFixed(1)}%*`);
      msgLines.push("");
    }

    msgLines.push(`_Generated from ${verified.length} verified PERFECT/STRONG signals (${todaySignals.length} total)_`);

    const message = msgLines.join("\n");

    // 6. Send via Telegram
    try {
      await supabase.functions.invoke("bot-send-telegram", {
        body: { message, parse_mode: "Markdown", admin_only: true },
      });
      log("Telegram digest sent ✅");
    } catch (tgErr: any) {
      log(`Telegram send error: ${tgErr.message}`);
    }

    return new Response(JSON.stringify({
      success: true,
      parlays: parlays.length,
      signals_used: verified.length,
      total_signals: todaySignals.length,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error: any) {
    log(`Error: ${error.message}`);
    return new Response(JSON.stringify({ success: false, error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
