import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MIN_CONFIDENCE = 60;            // global accuracy floor (matches parlay engine)
const CASCADE_MIN_PLAYERS = 3;        // ≥3 same-event same-direction picks = cascade
const DEDUPE_TTL_MIN = 120;           // 2-hour cross-run dedupe per Telegram rule
const MIN_JUICE_GAP = 15;             // min American-odds gap to consider a directional signal

// "Movement-free" detector tuning — used because unified_props is repriced
// once daily, so true intraday flips/velocity can't be measured. These two
// detectors instead surface (a) the steepest juice gap per game and
// (b) the rarest-priced props on the slate.
const TAKE_IT_NOW_MIN_GAP = 30;       // American odds gap that screams "book is hammering one side"
const VELOCITY_TOP_PERCENTILE = 0.05; // top 5% of derived confidence per (sport, prop_type)
const VELOCITY_MIN_CONFIDENCE = 70;   // raise the floor for "rare on slate"
const VELOCITY_MIN_GROUP_SIZE = 20;   // don't compute percentile on tiny pools

type UnifiedProp = {
  id: string;
  event_id: string;
  sport: string | null;
  game_description: string | null;
  commence_time: string | null;
  player_name: string | null;
  prop_type: string | null;
  bookmaker: string | null;
  current_line: number | null;
  over_price: number | null;
  under_price: number | null;
  composite_score: number | null;
  confidence: number | null;
  recommendation: string | null;
  recommended_side: string | null;
  pvs_tier: string | null;
  updated_at: string;
};

type ScoredProp = UnifiedProp & {
  derived_side: 'Over' | 'Under';
  derived_confidence: number;
  derived_score: number; // 0-100 magnitude (used for velocity baseline)
};

type Snapshot = {
  unified_prop_id: string;
  recommended_side: string | null;
  composite_score: number | null;
  confidence: number | null;
  snapshot_at: string;
};

function normaliseSport(s: string | null): string {
  if (!s) return 'UNKNOWN';
  const m: Record<string, string> = {
    basketball_nba: 'NBA',
    baseball_mlb: 'MLB',
    icehockey_nhl: 'NHL',
    americanfootball_nfl: 'NFL',
  };
  return m[s] || s.toUpperCase();
}

function dedupeKey(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? '').toString().toLowerCase().trim()).join('|');
}

// Derive direction + confidence from raw American odds.
// Logic: the "better" priced side (less negative / more positive) is the implied edge for the bettor.
// Confidence scales with the magnitude of the juice gap, mapped to a 60-90 range when the gap clears MIN_JUICE_GAP.
function scoreFromPrices(over: number | null, under: number | null): { side: 'Over' | 'Under'; confidence: number; score: number } | null {
  if (over == null || under == null) return null;
  const gap = Math.abs(over - under);
  if (gap < MIN_JUICE_GAP) return null;

  // The side that pays MORE has the implied edge (sharps don't need to juice it).
  const side: 'Over' | 'Under' = over > under ? 'Over' : 'Under';

  // Map gap -> confidence: 15 -> 60, 50+ -> 90
  const confidence = Math.min(90, Math.max(60, 60 + Math.round((gap - MIN_JUICE_GAP) * 0.85)));
  // 0..100 magnitude for velocity baseline
  const score = Math.min(100, gap);
  return { side, confidence, score };
}
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const stats = { snapshots: 0, cascades: 0, take_it_now: 0, velocity_spike: 0, deduped: 0, errors: 0 };

  try {
    // 1) Pull active props (only fresh ones with both prices). We derive direction from prices,
    //    not from `recommended_side`, because the upstream scorer is currently silent.
    const since = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString(); // last 6 hours (upstream sync cadence is loose)
    const { data: props, error: pErr } = await supabase
      .from('unified_props')
      .select('id,event_id,sport,game_description,commence_time,player_name,prop_type,bookmaker,current_line,over_price,under_price,composite_score,confidence,recommendation,recommended_side,pvs_tier,updated_at')
      .eq('is_active', true)
      .gte('updated_at', since)
      .not('over_price', 'is', null)
      .not('under_price', 'is', null);

    if (pErr) throw pErr;
    const rawProps = (props ?? []) as UnifiedProp[];

    // 2) Score each prop from raw prices
    const activeProps: ScoredProp[] = [];
    for (const p of rawProps) {
      const scored = scoreFromPrices(Number(p.over_price), Number(p.under_price));
      if (!scored) continue;
      if (scored.confidence < MIN_CONFIDENCE) continue;
      activeProps.push({
        ...p,
        derived_side: scored.side,
        derived_confidence: scored.confidence,
        derived_score: scored.score,
      });
    }
    console.log(`[signal-alert-engine] active props: ${rawProps.length} raw, ${activeProps.length} after scoring`);

    // 3) Snapshot every active prop (for future change detection)
    if (activeProps.length > 0) {
      const snapRows = activeProps.map((p) => ({
        unified_prop_id: p.id,
        event_id: p.event_id,
        sport: p.sport,
        player_name: p.player_name,
        prop_type: p.prop_type,
        current_line: p.current_line,
        over_price: p.over_price,
        under_price: p.under_price,
        composite_score: p.derived_score,
        confidence: p.derived_confidence,
        recommendation: p.recommendation,
        recommended_side: p.derived_side,
        pvs_tier: p.pvs_tier,
      }));
      const { error: snapErr } = await supabase.from('unified_props_snapshot').insert(snapRows);
      if (snapErr) console.error('[signal-alert-engine] snapshot insert failed:', snapErr);
      else stats.snapshots = snapRows.length;
    }

    // 3) Clean expired dedupe entries
    await supabase.from('signal_alert_dedupe').delete().lt('expires_at', new Date().toISOString());

    // Helper: try to claim a dedupe key
    const claimKey = async (key: string, signalType: string): Promise<boolean> => {
      const expires = new Date(Date.now() + DEDUPE_TTL_MIN * 60 * 1000).toISOString();
      const { error } = await supabase
        .from('signal_alert_dedupe')
        .insert({ dedupe_key: key, signal_type: signalType, expires_at: expires });
      if (error) {
        // unique violation = already alerted recently
        stats.deduped += 1;
        return false;
      }
      return true;
    };

    // 4) CASCADE detector — group by (event_id, prop_type, derived_side)
    const groups = new Map<string, ScoredProp[]>();
    for (const p of activeProps) {
      if (!p.event_id || !p.prop_type || !p.player_name) continue;
      const key = `${p.event_id}|${p.prop_type}|${p.derived_side.toLowerCase()}`;
      const arr = groups.get(key) ?? [];
      arr.push(p);
      groups.set(key, arr);
    }

    for (const [groupKey, members] of groups) {
      const distinctPlayers = Array.from(new Set(members.map((m) => m.player_name)));
      if (distinctPlayers.length < CASCADE_MIN_PLAYERS) continue;

      const first = members[0];
      const avgConfidence = Math.round(
        members.reduce((sum, m) => sum + m.derived_confidence, 0) / members.length,
      );
      if (avgConfidence < MIN_CONFIDENCE) continue;

      const dKey = dedupeKey(['cascade', groupKey]);
      if (!(await claimKey(dKey, 'cascade'))) continue;

      const playerBreakdown = members.map((m) => ({
        player: m.player_name,
        confidence: m.derived_confidence,
        composite: m.derived_score,
        line: Number(m.current_line ?? 0),
        side: m.derived_side,
        pvs_tier: m.pvs_tier,
      }));

      const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
        player_name: `TEAM CASCADE (${distinctPlayers.slice(0, 3).join(', ')}${distinctPlayers.length > 3 ? '…' : ''})`,
        event_id: first.event_id,
        signal_type: 'cascade',
        prediction: first.derived_side,
        confidence: avgConfidence,
        prop_type: first.prop_type,
        sport: normaliseSport(first.sport),
        bookmaker: first.bookmaker ?? 'unknown',
        event_description: first.game_description,
        commence_time: first.commence_time,
        metadata: {
          players_involved: distinctPlayers.length,
          direction: first.derived_side,
          line: first.current_line,
          alignment: 100,
          player_breakdown: playerBreakdown,
          source: 'unified_props_price_derived',
        },
      });
      if (insErr) {
        console.error('[signal-alert-engine] cascade insert failed:', insErr);
        stats.errors += 1;
      } else stats.cascades += 1;
    }

    // 5) TAKE-IT-NOW — "Sharpest Side Asymmetry"
    //    Logic: a prop with juice gap >= TAKE_IT_NOW_MIN_GAP (e.g. -105 / -135 → gap 30)
    //    AND it is the steepest juice gap in its game. The book is openly hammering one side.
    //    Movement-free: works on a single snapshot, no history required.
    {
      const gapByGame = new Map<string, number>(); // event_id → max gap seen
      const propGap = new Map<string, number>();   // prop.id → its gap
      for (const p of activeProps) {
        const over = Number(p.over_price ?? NaN);
        const under = Number(p.under_price ?? NaN);
        if (!Number.isFinite(over) || !Number.isFinite(under) || !p.event_id) continue;
        const gap = Math.abs(over - under);
        propGap.set(p.id, gap);
        const cur = gapByGame.get(p.event_id) ?? 0;
        if (gap > cur) gapByGame.set(p.event_id, gap);
      }

      for (const p of activeProps) {
        const gap = propGap.get(p.id) ?? 0;
        if (gap < TAKE_IT_NOW_MIN_GAP) continue;
        if (!p.event_id) continue;
        const top = gapByGame.get(p.event_id) ?? 0;
        if (gap < top) continue; // only the steepest gap in the game

        const conf = p.derived_confidence;
        if (conf < MIN_CONFIDENCE) continue;

        const dKey = dedupeKey(['take_it_now', p.event_id, p.player_name, p.prop_type, p.derived_side]);
        if (!(await claimKey(dKey, 'take_it_now'))) continue;

        const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
          player_name: p.player_name,
          event_id: p.event_id,
          signal_type: 'take_it_now',
          prediction: p.derived_side,
          confidence: Math.round(conf),
          prop_type: p.prop_type,
          sport: normaliseSport(p.sport),
          bookmaker: p.bookmaker ?? 'unknown',
          event_description: p.game_description,
          commence_time: p.commence_time,
          metadata: {
            detector: 'sharpest_juice_gap',
            juice_gap: gap,
            over_price: p.over_price,
            under_price: p.under_price,
            line: p.current_line,
            pvs_tier: p.pvs_tier,
            source: 'unified_props_price_derived',
          },
        });
        if (insErr) {
          console.error('[signal-alert-engine] take_it_now insert failed:', insErr);
          stats.errors += 1;
        } else stats.take_it_now += 1;
      }
    }

    // 6) VELOCITY SPIKE — "Slate Outlier"
    //    Logic: derived_confidence is in the top VELOCITY_TOP_PERCENTILE for its
    //    (sport, prop_type) cohort AND >= VELOCITY_MIN_CONFIDENCE. The slate is
    //    telling us this is a rare price. Movement-free, computed cross-sectionally.
    {
      const cohorts = new Map<string, ScoredProp[]>();
      for (const p of activeProps) {
        if (!p.prop_type) continue;
        const key = `${normaliseSport(p.sport)}|${p.prop_type}`;
        const arr = cohorts.get(key) ?? [];
        arr.push(p);
        cohorts.set(key, arr);
      }

      for (const [cohortKey, members] of cohorts) {
        if (members.length < VELOCITY_MIN_GROUP_SIZE) continue;
        const sorted = [...members].sort((a, b) => b.derived_confidence - a.derived_confidence);
        const cutoffIdx = Math.max(1, Math.floor(sorted.length * VELOCITY_TOP_PERCENTILE));
        const winners = sorted.slice(0, cutoffIdx);
        const cohortAvg = members.reduce((s, m) => s + m.derived_confidence, 0) / members.length;

        for (const p of winners) {
          if (p.derived_confidence < VELOCITY_MIN_CONFIDENCE) continue;
          if (!p.event_id || !p.player_name) continue;

          const dKey = dedupeKey(['velocity_spike', p.event_id, p.player_name, p.prop_type]);
          if (!(await claimKey(dKey, 'velocity_spike'))) continue;

          const { error: insErr } = await supabase.from('fanduel_prediction_alerts').insert({
            player_name: p.player_name,
            event_id: p.event_id,
            signal_type: 'velocity_spike',
            prediction: p.derived_side,
            confidence: Math.round(p.derived_confidence),
            prop_type: p.prop_type,
            sport: normaliseSport(p.sport),
            bookmaker: p.bookmaker ?? 'unknown',
            event_description: p.game_description,
            commence_time: p.commence_time,
            metadata: {
              detector: 'slate_outlier',
              cohort_key: cohortKey,
              cohort_size: members.length,
              cohort_avg_confidence: Math.round(cohortAvg * 10) / 10,
              percentile_rank: Math.round((1 - winners.indexOf(p) / sorted.length) * 1000) / 10,
              over_price: p.over_price,
              under_price: p.under_price,
              line: p.current_line,
              source: 'unified_props_price_derived',
            },
          });
          if (insErr) {
            console.error('[signal-alert-engine] velocity_spike insert failed:', insErr);
            stats.errors += 1;
          } else stats.velocity_spike += 1;
        }
      }
    }

    return new Response(JSON.stringify({ success: true, stats }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[signal-alert-engine] fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg, stats }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});