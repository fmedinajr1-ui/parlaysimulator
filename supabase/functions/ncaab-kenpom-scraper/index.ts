import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * ncaab-efficiency-calculator (PAE Formula v2)
 * 
 * Computes "Parlay Adjusted Efficiency" ratings using ESPN data.
 * When SOS rank is missing, estimates it from conference strength.
 */

// Conference strength tiers — estimated median SOS rank for each conference
const CONFERENCE_SOS: Record<string, number> = {
  'SEC': 10, 'Big 12': 15, 'Big Ten': 20, 'ACC': 28, 'Big East': 35,
  'Mountain West': 65, 'American': 75, 'WCC': 85, 'MVC': 100, 'A-10': 110,
  'MAC': 130, 'Sun Belt': 140, 'CUSA': 145, 'CAA': 135, 'Ivy': 150,
  'Horizon': 160, 'SoCon': 155, 'Big Sky': 170, 'Big West': 175,
  'WAC': 180, 'ASUN': 185, 'Patriot': 190, 'Summit': 195, 'MAAC': 140,
  'NEC': 230, 'Southland': 240, 'OVC': 245, 'Big South': 250,
  'Am. East': 255, 'MEAC': 310, 'SWAC': 320,
};

interface TeamRow {
  team_name: string;
  ppg: number | null;
  oppg: number | null;
  home_record: string | null;
  away_record: string | null;
  sos_rank: number | null;
  conference: string | null;
}

function parseRecord(record: string | null): { wins: number; losses: number } {
  if (!record) return { wins: 0, losses: 0 };
  const m = record.match(/(\d+)-(\d+)/);
  if (!m) return { wins: 0, losses: 0 };
  return { wins: parseInt(m[1]), losses: parseInt(m[2]) };
}

function estimateSOS(team: TeamRow): number {
  // Use real SOS if available
  if (team.sos_rank && team.sos_rank > 0) return team.sos_rank;

  // Estimate from conference
  const confSOS = CONFERENCE_SOS[team.conference || ''] || 181;

  // Adjust within conference by win rate — better teams in tough conferences get lower SOS
  const home = parseRecord(team.home_record);
  const away = parseRecord(team.away_record);
  const totalW = home.wins + away.wins;
  const totalG = totalW + home.losses + away.losses;
  const winRate = totalG > 0 ? totalW / totalG : 0.5;

  // Better teams face harder schedules within their conference range
  // A .900 team in SEC -> SOS ~10, a .400 team in SEC -> SOS ~25
  const withinConfAdj = (0.5 - winRate) * 20;

  return Math.max(1, Math.min(362, Math.round(confSOS + withinConfAdj)));
}

function calculatePAE(teams: TeamRow[]) {
  const withData = teams.filter(t => t.ppg && t.ppg > 0 && t.oppg && t.oppg > 0);
  const d1AvgPPG = withData.length > 0
    ? withData.reduce((s, t) => s + (t.ppg || 0), 0) / withData.length
    : 76.8;

  console.log(`[PAE] D1 avg PPG: ${d1AvgPPG.toFixed(1)} from ${withData.length} teams`);

  const AVG_POSS = 67;
  const TOTAL = 362;
  const MID = 181;

  const results: {
    team_name: string;
    pae_o: number;
    pae_d: number;
    pae_net: number;
    power_rating: number;
    est_tempo: number;
    est_sos: number;
  }[] = [];

  for (const team of teams) {
    const sos = estimateSOS(team);

    let ppg = team.ppg && team.ppg > 0 ? team.ppg : d1AvgPPG - (sos - MID) * 0.03;
    let oppg = team.oppg && team.oppg > 0 ? team.oppg : d1AvgPPG + (sos - MID) * 0.03;

    const estPoss = ((ppg + oppg) / 2) / d1AvgPPG * AVG_POSS;

    // Raw per-100 efficiency
    const rawO = (ppg / estPoss) * 100;
    const rawD = (oppg / estPoss) * 100;

    // SOS additive adjustment (±6 points max)
    const sosAdj = (MID - sos) / TOTAL * 16;

    const paeO = rawO + sosAdj;
    const paeD = rawD - sosAdj;
    const paeNet = paeO - paeD;

    // Win bonus
    const home = parseRecord(team.home_record);
    const away = parseRecord(team.away_record);
    const totalW = home.wins + away.wins;
    const totalG = totalW + home.losses + away.losses;
    const winRate = totalG > 0 ? totalW / totalG : 0.5;
    const winBonus = (winRate - 0.5) * 6;

    results.push({
      team_name: team.team_name,
      pae_o: Math.round(paeO * 10) / 10,
      pae_d: Math.round(paeD * 10) / 10,
      pae_net: Math.round(paeNet * 10) / 10,
      power_rating: Math.round((paeNet + winBonus) * 100) / 100,
      est_tempo: Math.round(estPoss * 10) / 10,
      est_sos: sos,
    });
  }

  results.sort((a, b) => b.power_rating - a.power_rating);
  return results;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    console.log('[PAE Calculator v2] Starting...');

    // Step 1: Clean garbage values
    await supabase
      .from('ncaab_team_stats')
      .update({ kenpom_adj_o: null, kenpom_adj_d: null, kenpom_source: null, kenpom_rank: null })
      .or('kenpom_adj_d.lt.80,kenpom_adj_d.gt.120');

    // Step 2: Load all teams WITH conference and existing PAE data
    const { data: allTeams, error: fetchError } = await supabase
      .from('ncaab_team_stats')
      .select('team_name, ppg, oppg, home_record, away_record, sos_rank, conference, adj_offense, adj_defense')
      .order('team_name');

    if (fetchError || !allTeams?.length) {
      return new Response(JSON.stringify({ success: false, error: fetchError?.message || 'No teams' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Split: teams with ESPN data get PAE calculated; teams without ESPN data but with prior PAE keep their values
    const teamsWithData = allTeams.filter(t => t.ppg && t.ppg > 0 && t.oppg && t.oppg > 0);
    const teamsWithoutData = allTeams.filter(t => !t.ppg || t.ppg <= 0 || !t.oppg || t.oppg <= 0);
    const teamsWithPriorPAE = teamsWithoutData.filter(t => t.adj_offense && t.adj_offense > 0 && t.adj_defense && t.adj_defense > 0);
    const teamsSkipped = teamsWithoutData.filter(t => !t.adj_offense || t.adj_offense <= 0 || !t.adj_defense || t.adj_defense <= 0);

    console.log(`[PAE] Loaded ${allTeams.length} teams: ${teamsWithData.length} with ESPN data, ${teamsWithPriorPAE.length} preserving prior PAE, ${teamsSkipped.length} skipped (no data)`);

    // Step 3: Calculate PAE only for teams with actual ESPN data
    const ranked = calculatePAE(teamsWithData);

    console.log('[PAE] Top 15:', ranked.slice(0, 15).map((t, i) =>
      `#${i+1} ${t.team_name} (O:${t.pae_o} D:${t.pae_d} NET:${t.pae_net} SOS:${t.est_sos})`
    ));

    // Step 4: Batch upsert (chunks of 50)
    let updated = 0;
    const errors: string[] = [];

    for (let i = 0; i < ranked.length; i += 50) {
      const chunk = ranked.slice(i, i + 50).map((t, idx) => ({
        team_name: t.team_name,
        kenpom_rank: i + idx + 1,
        kenpom_adj_o: t.pae_o,
        kenpom_adj_d: t.pae_d,
        adj_offense: t.pae_o,
        adj_defense: t.pae_d,
        adj_tempo: t.est_tempo,
        kenpom_source: 'pae_formula',
        updated_at: new Date().toISOString(),
      }));

      const { error } = await supabase
        .from('ncaab_team_stats')
        .upsert(chunk, { onConflict: 'team_name' });

      if (error) errors.push(error.message);
      else updated += chunk.length;
    }

    const summary = {
      success: true, source: 'pae_formula',
      teams_total: allTeams.length,
      teams_with_espn: allTeams.filter(t => t.ppg && t.ppg > 0).length,
      teams_with_real_sos: allTeams.filter(t => t.sos_rank).length,
      teams_updated: updated,
      top_10: ranked.slice(0, 10).map((t, i) =>
        `#${i+1} ${t.team_name} (O:${t.pae_o} D:${t.pae_d} SOS:${t.est_sos})`
      ),
      errors: errors.slice(0, 3),
    };

    console.log('[PAE v2] Done:', JSON.stringify(summary));

    await supabase.from('cron_job_history').insert({
      job_name: 'ncaab-kenpom-scraper', status: 'completed',
      started_at: new Date().toISOString(), completed_at: new Date().toISOString(),
      result: summary,
    });

    return new Response(JSON.stringify(summary), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    console.error('[PAE v2] Fatal:', msg);
    return new Response(JSON.stringify({ success: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
