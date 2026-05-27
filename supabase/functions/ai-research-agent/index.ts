/**
 * ai-research-agent
 * 
 * Daily AI research agent using Perplexity to gather intelligence on:
 * 1. Competing AI betting systems & strategies
 * 2. Advanced statistical models & edges
 * 3. Injury/lineup intel across sports
 * 4. NCAA Baseball pitching matchups
 * 5. Weather impact on totals
 * 6. NCAAB KenPom matchups & tempo analysis
 * 7. NCAAB injury & lineup intel
 * 8. NCAAB sharp money & line movement
 * 9. NBA/NHL sharp money & whale alerts
 * 10. Value line discrepancies — consensus models vs books
 * 11. Situational spots — letdown, revenge, travel fatigue
 * 
 * Stores findings in bot_research_findings table and sends Telegram digest.
 * Runs daily via cron.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEARCH_QUERIES = [
  {
    category: 'competing_ai',
    query: "List up to 5 specific AI / quant sports-betting picks reported in the last 24 hours for tonight's NBA, NHL, or MLB slate. Each bullet MUST name the system (e.g. Unabated, BetLabs, Action Network PRO, OddsJam), the team or player, the side and line, and a one-sentence reason. Do NOT describe methodology or capabilities. Do NOT mention partnerships, sponsorships, or product launches. If you cannot find any real picks reported today, reply with exactly: NO_INTEL",
    systemPrompt: 'You report real, current betting picks from named AI/quant systems. Never describe what a system does — only the actual picks it published today. If none exist, return NO_INTEL. Never list features, partnerships, or capabilities.',
  },
  {
    category: 'statistical_models',
    query: "List up to 5 specific statistical-model picks (FiveThirtyEight, Inpredictable, Dratings, numberFire, Sagarin, KenPom) published in the last 24 hours where the model projection disagrees with the current sportsbook line for tonight's NBA, NHL, or MLB games. Each bullet MUST include: model name, team or player, model projection, current book line, and the gap. Do NOT describe what models do. If no concrete disagreements are reported today, reply with exactly: NO_INTEL",
    systemPrompt: 'You report specific model-vs-market disagreements published today, with real numbers. Never describe methodology. If you cannot cite a real projection vs a real line, return NO_INTEL.',
  },
  {
    category: 'injury_intel',
    query: "Give me 3-5 NBA, NHL, or MLB player status / injury / rest updates from this week. For each: player full name, team, current designation (OUT / QUESTIONABLE / GTD / DTD / probable / load management / IN), and a one-sentence note on rotation or prop impact. Use ESPN, NBA.com, Rotowire, CBS Sports, or team reports. Posted bookmaker numbers are NOT required.",
    systemPrompt: 'You report real player injury and status news from this week with full names and teams. Always produce at least 3 bullets if any sports are in season — do not refuse just because numbers are missing.',
  },
  {
    category: 'ncaa_baseball_pitching',
    query: "List up to 5 specific NCAA baseball probable starters for today's games. Each bullet MUST contain pitcher name, team, opponent, season ERA, and WHIP. If no NCAA baseball games today or you cannot find real starters, reply with exactly: NO_INTEL. Never ask the user to paste a slate. Never describe what you would analyze.",
    systemPrompt: 'You report named NCAA baseball probable starters with real ERA/WHIP. Never ask for input. Never describe methodology. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'weather_totals_impact',
    query: "Give me 3-5 MLB games on today's or tomorrow's slate where weather could influence the total. For each: matchup (Team A @ Team B), ballpark, weather factor (wind dir/speed, temp, precip, dome), and a brief OVER/UNDER lean. Use Weather.com, Ballpark Pal, or ESPN MLB schedule. Posted totals are NOT required.",
    systemPrompt: 'You list named MLB matchups with forecast conditions. Produce 3-5 bullets whenever the MLB regular season is active.',
  },
  {
    category: 'ncaab_team_scoring_trends',
    query: "List up to 5 specific NCAAB games today where recent scoring trends point clearly OVER or UNDER the posted total. Each bullet MUST contain: matchup, posted total, combined recent PPG average, and OVER/UNDER lean. If you cannot cite real numbers, reply with exactly: NO_INTEL. Never ask the user to paste data.",
    systemPrompt: 'You report named NCAAB games with real totals and real recent scoring numbers. Never ask for input. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'ncaab_scoring_validation',
    query: "List up to 5 specific NCAAB totals today that look mispriced based on recent team performance. Each bullet MUST contain: matchup, posted total, last-3 combined average points, and whether the total is inflated or deflated by how many points. Cite real numbers only. If none found, reply with exactly: NO_INTEL",
    systemPrompt: 'You report specific mispriced NCAAB totals with real recent scoring numbers. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'ncaab_injury_lineups',
    query: "List up to 5 confirmed NCAAB injury or lineup updates reported in the last 24 hours affecting today's games. Each bullet MUST contain player full name, team, status, and one-sentence line/total impact. If no real updates, reply with exactly: NO_INTEL",
    systemPrompt: 'You report confirmed NCAAB injury news only, with player names and statuses. If none, return NO_INTEL.',
  },
  {
    category: 'ncaab_sharp_signals',
    query: "List up to 5 NCAAB games today with documented sharp money signals reported in the last 24 hours. Each bullet MUST contain: matchup, market (spread/total/ML), opening line, current line, and ticket% vs money% if known. Generic labels like 'Opening line vs current line' are NOT acceptable — give the real numbers. If no real signals, reply with exactly: NO_INTEL",
    systemPrompt: 'You report specific NCAAB sharp signals with real opening and current line numbers from the last 24 hours. Never list generic categories or headers. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'nba_nhl_sharp_signals',
    query: "List up to 5 NBA or NHL sharp signals reported in the last 24 hours for tonight's games. Each bullet MUST contain: team or player full name, market, opening number, current number, and direction. Example format: 'Knicks @ Cavs total: opened 218.5, now 215.5, 72% money on Under.' If no real reported signals, reply with exactly: NO_INTEL",
    systemPrompt: 'You report NBA/NHL sharp signals with real opening and current numbers from the last 24 hours. No general commentary. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'value_line_discrepancies',
    query: "List up to 5 games today with documented model-vs-book value gaps (NBA, NHL, NCAAB, or MLB). Each bullet MUST contain: matchup, model name, model projection, current book line, and edge in points or %. Example: 'KenPom projects Duke -6, book has Duke -2.5, 3.5-pt edge on Duke.' If no concrete gaps, reply with exactly: NO_INTEL",
    systemPrompt: 'You report real model-vs-book gaps with both numbers cited. Never describe models. If none, return NO_INTEL.',
  },
  {
    category: 'situational_spots',
    query: "List up to 5 specific situational angles for tonight's NBA, NHL, or NCAAB games. Each bullet MUST contain: matchup, situation type (letdown / revenge / B2B / fatigue / lookahead), and ATS lean with one-sentence reason. If no concrete spots found, reply with exactly: NO_INTEL",
    systemPrompt: 'You report named matchups with real situational angles tonight. Never list angle categories generically. If none, return NO_INTEL.',
  },
  {
    category: 'tennis_sharp_signals',
    query: "List up to 5 ATP/WTA matches today with sharp signals reported in the last 24 hours. Each bullet MUST contain: player A vs player B, surface, market (ML/total games/set spread), opening number, current number. If none, reply with exactly: NO_INTEL",
    systemPrompt: 'You report tennis sharp signals with real opening/current numbers from the last 24 hours. If none, return NO_INTEL.',
  },
  {
    category: 'tennis_form_matchups',
    query: "Give me 3-5 ATP, WTA, or Challenger matchups scheduled today or tomorrow with a form, surface, fatigue, or H2H angle. For each: player A vs player B, tournament, surface, short rationale, directional lean. Use ATP Tour, WTA, Tennis.com. Approximate form is acceptable.",
    systemPrompt: 'You list named tennis matchups with a clear rationale. Produce 3-5 bullets whenever tour matches are scheduled.',
  },
  {
    category: 'table_tennis_signals',
    query: "List up to 5 specific table tennis (WTT, ITTF, TT Cup, Setka Cup) matches today with a quantitative edge. Each bullet MUST contain: player A vs player B, event, posted total points (if available), recent match total average, and over/under lean. Never describe what you would analyze. If no real matches with numbers, reply with exactly: NO_INTEL",
    systemPrompt: 'You report named table tennis matches with real recent total-points numbers. Never describe methodology or ask for input. If nothing concrete, return NO_INTEL.',
  },
  {
    category: 'whale_money_steam_moves',
    query: "List up to 5 documented whale-sized prop bets or steam moves reported in the last 24 hours. Each bullet MUST contain: real player full name, real prop type, opening number, current number, and source. Do NOT invent examples. If zero verified signals, reply with exactly: NO_INTEL",
    systemPrompt: 'You are an elite sharp money tracker. Only report signals documented in the last 24 hours from VSiN, Action Network, Pregame, Unabated, OddsTrader, or sportsbook social posts. Every signal must include real player full name, real prop type, real opening and current numbers, and the source. NEVER output placeholder tokens. NEVER fabricate. If zero verified signals, respond with exactly: NO_INTEL',
  },
];

async function queryPerplexity(
  apiKey: string,
  query: string,
  systemPrompt: string
): Promise<{ content: string; citations: string[] }> {
  // Reputable sports sources — Perplexity's default web index often skips sports
  // pages, so we steer it at known feeds. Mix of national, team, and props/odds.
  const SPORTS_DOMAINS = [
    'espn.com', 'cbssports.com', 'nba.com', 'nhl.com', 'mlb.com',
    'rotowire.com', 'rotoworld.com', 'sportsline.com', 'theathletic.com',
    'actionnetwork.com', 'vsin.com', 'oddsshark.com', 'covers.com',
    'pregame.com', 'unabated.com', 'baseballreference.com', 'kenpom.com',
    'tennis.com', 'atptour.com', 'wtatennis.com',
    'weather.com', 'ballparkpal.com',
  ];
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar-pro',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      search_recency_filter: 'week',
      search_domain_filter: SPORTS_DOMAINS,
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  let content: string = data.choices?.[0]?.message?.content || '';
  // Strip chain-of-thought wrappers if a reasoning model is used.
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  return {
    content,
    citations: data.citations || [],
  };
}

function extractInsights(content: string): string[] {
  // NO_INTEL short-circuit — model explicitly said it has nothing.
  if (/\bNO_INTEL\b|\bNO_VERIFIED_SIGNALS_TODAY\b/i.test(content)) return [];

  const lines = content.split('\n').filter(l => l.trim());
  const insights: string[] = [];

  // Schema placeholder / fabricated row patterns.
  const PLACEHOLDER_PATTERNS: RegExp[] = [
    /\bPLAYER\s*NAME\b/i, /\bPLAYER_NAME\b/i,
    /\bPROP\s*TYPE\b/i, /\bPROP_TYPE\b/i,
    /\bTEAM\s*NAME\b/i, /\bBOOK\s*NAME\b/i,
    /\bSTAT\s*\|/i, /\bDIRECTION\s*\|/i, /\bSIDE\s*\|/i,
    /\bOVER\s*\/\s*UNDER\s*\)/i,
    /\bN\/A\s*\|\s*N\/A\b/i,
    /\bexample[:\s]/i,
  ];

  // Meta / instruction verbs that mean the model is describing methodology, not reporting intel.
  const INSTRUCTION_VERB = /^(identify|analyze|explain|flag|provide|paste|list out|determine|consider|compare|review|track|focus|share|build|calculate|estimate|profile|monitor|use|note that|then,|next,)\b/i;

  // Phrases that signal "I have no real data" or "I'm describing capabilities".
  const META_PHRASES = [
    /not\s+(yet\s+)?available/i,
    /no\s+match\s+stats/i,
    /from\s+the\s+snippet/i,
    /in\s+the\s+snippet/i,
    /not\s+shown/i,
    /placeholder/i,
    /unavailable/i,
    /here'?s\s+how/i,
    /i\s+can\s+help/i,
    /share\s+your/i,
    /paste\s+your/i,
    /you\s+can\s+(paste|share|provide)/i,
    /a\s+(projection|probability|bet[\s-]sizing)\s+(model|layer)/i,
    /what\s+we\s+can\s+say/i,
    /reportedly\s+selected/i,
    /partner(ship)?/i,
    /world\s+cup\s+2026\s+prediction\s+market/i,
  ];

  // Label-only lines (e.g. "Source: OddsIndex snippet", "Status: Not available", "Opening line vs current line")
  const LABEL_ONLY_PREFIX = /^(source|status|event\/?surface|recent form|surface win rate|opening line vs current line|ticket\s*%|signal|market signal|impact|game impact|injury)\s*[:\-]/i;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!(/^[-•*]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed) || /^\*\*/.test(trimmed))) continue;

    const clean = trimmed.replace(/^[-•*\d.)]+\s*/, '').replace(/\*\*/g, '').trim();
    if (clean.length <= 25 || clean.length >= 500) continue;

    if (PLACEHOLDER_PATTERNS.some(rx => rx.test(clean))) continue;
    if (INSTRUCTION_VERB.test(clean)) continue;
    if (META_PHRASES.some(rx => rx.test(clean))) continue;
    if (LABEL_ONLY_PREFIX.test(clean)) {
      // Allow label lines only if they contain a real number after the colon.
      const afterColon = clean.split(':').slice(1).join(':').trim();
      if (!/\d/.test(afterColon) || afterColon.length < 6) continue;
    }

    // Real intel almost always contains a digit OR a capitalized proper-noun token (2+ chars).
    const hasDigit = /\d/.test(clean);
    const hasProperNoun = /\b[A-Z][a-z]{2,}\b/.test(clean);
    if (!hasDigit && !hasProperNoun) continue;

    insights.push(clean);
  }

  return insights.slice(0, 10);
}

/**
 * Quality-based relevance score: rewards count, real numbers, and proper-noun mentions.
 * Returns 0.0–1.0. <0.40 = unusable, 0.40–0.65 = thin, >=0.65 = actionable.
 */
function qualityScore(insights: string[]): number {
  if (!insights.length) return 0;
  const countScore = Math.min(1, insights.length / 5);
  const withNumber = insights.filter(i => /\d/.test(i)).length / insights.length;
  const withProperNoun = insights.filter(i => /\b[A-Z][a-z]{2,}\b/.test(i)).length / insights.length;
  return Math.round((0.5 * countScore + 0.3 * withNumber + 0.2 * withProperNoun) * 100) / 100;
}

/** Cross-reference today's whale_picks against Perplexity research findings */
async function crossReferenceWhalePicks(supabase: any): Promise<{ totalPicks: number; matched: number; boosted: number }> {
  const today = new Date().toISOString().split('T')[0];

  // Fetch today's unsettled whale picks
  const { data: whalePicks, error: wpErr } = await supabase
    .from('whale_picks')
    .select('*')
    .eq('detected_at_date', today)
    .is('outcome', null);

  if (wpErr || !whalePicks?.length) {
    console.log(`[Research Agent] Whale cross-ref: ${wpErr ? 'error' : 'no picks found'}`);
    return { totalPicks: 0, matched: 0, boosted: 0 };
  }

  // Fetch today's sharp signal findings
  const sharpCategories = [
    'whale_money_steam_moves', 'nba_nhl_sharp_signals', 'ncaab_sharp_signals',
    'tennis_sharp_signals', 'table_tennis_signals'
  ];
  const { data: findings } = await supabase
    .from('bot_research_findings')
    .select('category, summary, key_insights')
    .eq('research_date', today)
    .in('category', sharpCategories);

  if (!findings?.length) {
    console.log('[Research Agent] Whale cross-ref: no sharp findings to match against');
    return { totalPicks: whalePicks.length, matched: 0, boosted: 0 };
  }

  // Build searchable text from all findings
  const intelTexts: string[] = [];
  for (const f of findings) {
    if (f.summary) intelTexts.push(f.summary.toLowerCase());
    if (Array.isArray(f.key_insights)) {
      for (const insight of f.key_insights) {
        if (typeof insight === 'string') intelTexts.push(insight.toLowerCase());
      }
    }
  }
  const combinedIntel = intelTexts.join(' ');

  let matched = 0;
  let boosted = 0;

  for (const pick of whalePicks) {
    const playerName = (pick.player_name || '').toLowerCase().trim();
    if (!playerName || playerName.length < 3) continue;

    // Check if player name appears in findings
    const nameParts = playerName.split(' ');
    const lastName = nameParts[nameParts.length - 1];
    const fullNameFound = combinedIntel.includes(playerName);
    const lastNameFound = lastName.length >= 4 && combinedIntel.includes(lastName);

    if (!fullNameFound && !lastNameFound) continue;

    matched++;

    // Determine match quality
    const statType = (pick.stat_type || '').toLowerCase();
    const direction = (pick.direction || '').toLowerCase();
    
    // Check for prop type match (pts, reb, ast, sog, saves, etc.)
    const propTypeFound = statType && combinedIntel.includes(statType);
    // Check for direction match (over/under)
    const directionFound = direction && combinedIntel.includes(direction);

    let boost = 5; // Base: player mentioned in sharp context
    let matchDetail = 'mentioned in sharp signals';

    if (propTypeFound && directionFound) {
      boost = 12;
      matchDetail = `${statType} ${direction} confirmed by sharp action`;
    } else if (directionFound) {
      boost = 8;
      matchDetail = `${direction} direction confirmed by sharp money`;
    }

    const currentScore = pick.sharp_score || 0;
    const newScore = Math.min(100, currentScore + boost);
    const newGrade = newScore >= 80 ? 'A' : newScore >= 65 ? 'B' : newScore >= 55 ? 'C' : 'D';

    // Update why_short with Perplexity conviction
    const currentWhy: string[] = Array.isArray(pick.why_short) ? [...pick.why_short] : [];
    currentWhy.push(`Perplexity conviction: ${matchDetail} (+${boost})`);

    const { error: updateErr } = await supabase
      .from('whale_picks')
      .update({
        sharp_score: newScore,
        confidence_grade: newGrade,
        why_short: currentWhy,
      })
      .eq('id', pick.id);

    if (!updateErr) {
      boosted++;
      console.log(`[Research Agent] Whale cross-ref: ${pick.player_name} boosted +${boost} → ${newScore} (${newGrade})`);
    }
  }

  console.log(`[Research Agent] Whale cross-ref complete: ${matched}/${whalePicks.length} matched, ${boosted} boosted`);
  return { totalPicks: whalePicks.length, matched, boosted };
}


function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Parse optional force flag to bypass dedup guard
    const body = await req.json().catch(() => ({}));
    const forceRun = body?.force === true;

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const perplexityKey = Deno.env.get('PERPLEXITY_API_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    if (!perplexityKey) {
      throw new Error('PERPLEXITY_API_KEY not configured');
    }

    // === DEDUPLICATION GUARD ===
    const today = new Date().toISOString().split('T')[0];
    const { count: existingCount } = await supabase
      .from('bot_research_findings')
      .select('*', { count: 'exact', head: true })
      .eq('research_date', today);

    if (!forceRun && existingCount && existingCount > 0) {
      console.log(`[Research Agent] Already ran today (${existingCount} findings exist for ${today}). Skipping.`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: `Already ran today — ${existingCount} findings exist for ${today}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (forceRun) {
      console.log(`[Research Agent] Force run requested — bypassing dedup guard (${existingCount ?? 0} existing findings).`);
    }

    console.log('[Research Agent] Starting daily research...');

    const findings: Array<{
      category: string;
      title: string;
      summary: string;
      key_insights: string[];
      sources: string[];
      relevance_score: number;
    }> = [];

    // Run all research queries
    for (const rq of RESEARCH_QUERIES) {
      try {
        console.log(`[Research Agent] Querying: ${rq.category}`);
        const result = await queryPerplexity(perplexityKey, rq.query, rq.systemPrompt);
        
        const insights = extractInsights(result.content);
        console.log(`[Research Agent] ${rq.category}: ${insights.length} insights, raw len=${result.content.length}, sample=${result.content.slice(0, 240).replace(/\n/g, ' ')}`);
        const titleMap: Record<string, string> = {
          competing_ai: 'AI Betting Systems Intelligence',
          statistical_models: 'Statistical Edge Research',
          injury_intel: 'Injury & Lineup Intel',
          ncaa_baseball_pitching: 'NCAA Baseball Pitching Matchups',
          weather_totals_impact: 'Weather Impact on Totals',
          ncaab_team_scoring_trends: 'NCAAB Team Scoring Trends',
          ncaab_scoring_validation: 'NCAAB Scoring Validation',
          ncaab_injury_lineups: 'NCAAB Injury & Lineup Intel',
          ncaab_sharp_signals: 'NCAAB Sharp Money Signals',
          nba_nhl_sharp_signals: 'NBA/NHL Whale & Sharp Signals',
          value_line_discrepancies: 'Value Line Discrepancies',
          situational_spots: 'Situational Betting Spots',
          tennis_sharp_signals: 'Tennis Sharp Signals',
          tennis_form_matchups: 'Tennis Form & Matchups',
          table_tennis_signals: 'Table Tennis Signals',
          whale_money_steam_moves: 'Whale Money & Steam Moves',
        };

        findings.push({
          category: rq.category,
          title: titleMap[rq.category] || rq.category,
          summary: result.content.slice(0, 2000),
          key_insights: insights,
          sources: result.citations.slice(0, 5),
          relevance_score: qualityScore(insights),
        });
      } catch (err) {
        console.error(`[Research Agent] Error on ${rq.category}:`, err);
        findings.push({
          category: rq.category,
          title: `${rq.category} (failed)`,
          summary: `Research failed: ${err instanceof Error ? err.message : 'Unknown error'}`,
          key_insights: [],
          sources: [],
          relevance_score: 0,
        });
      }
    }

    // Store findings in DB
    const inserts = findings.map(f => ({
      research_date: today,
      category: f.category,
      title: f.title,
      summary: f.summary,
      key_insights: f.key_insights,
      sources: f.sources,
      relevance_score: f.relevance_score,
      actionable: f.relevance_score >= 0.65,
    }));

    const { error: insertError } = await supabase
      .from('bot_research_findings')
      .upsert(inserts, { onConflict: 'category,research_date' });

    if (insertError) {
      console.error('[Research Agent] Insert error:', insertError);
    }

    // === CROSS-REFERENCE WHALE PICKS ===
    const whaleCrossRef = await crossReferenceWhalePicks(supabase);

    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });

    const emojiMap: Record<string, string> = {
      competing_ai: '🤖',
      statistical_models: '📊',
      injury_intel: '🏥',
      ncaa_baseball_pitching: '⚾',
      weather_totals_impact: '🌬️',
      ncaab_team_scoring_trends: '🎓',
      ncaab_scoring_validation: '📊',
      ncaab_injury_lineups: '🏀',
      ncaab_sharp_signals: '💰',
      nba_nhl_sharp_signals: '🐋',
      value_line_discrepancies: '📐',
      situational_spots: '🎯',
      tennis_sharp_signals: '🎾',
      tennis_form_matchups: '🎾',
      table_tennis_signals: '🏓',
      whale_money_steam_moves: '🐳',
    };

    let digestMessage = `🔬 <b>AI Research Digest — ${escapeHtml(dateStr)}</b>\n\n`;

    const TELEGRAM_LIMIT = 4096;
    const TELEGRAM_SOFT_LIMIT = 3800;
    const stripHtml = (text: string) => text.replace(/<[^>]+>/g, '');
    const splitTelegramMessage = (text: string, limit: number = TELEGRAM_SOFT_LIMIT): string[] => {
      if (text.length <= limit) return [text];

      const sections = text.split(/\n\n+/);
      const chunks: string[] = [];
      let current = '';

      const flush = () => {
        if (current.trim()) chunks.push(current.trim());
        current = '';
      };

      for (const section of sections) {
        const next = current ? `${current}\n\n${section}` : section;
        if (next.length <= limit) {
          current = next;
          continue;
        }

        if (current) flush();

        if (section.length <= limit) {
          current = section;
          continue;
        }

        const lines = section.split('\n');
        let partial = '';
        for (const line of lines) {
          const lineNext = partial ? `${partial}\n${line}` : line;
          if (lineNext.length <= limit) {
            partial = lineNext;
            continue;
          }

          if (partial) chunks.push(partial.trim());

          if (line.length <= limit) {
            partial = line;
            continue;
          }

          let remaining = line;
          while (remaining.length > limit) {
            let splitAt = remaining.lastIndexOf(' ', limit);
            if (splitAt < Math.floor(limit * 0.6)) splitAt = limit;
            chunks.push(remaining.slice(0, splitAt).trim());
            remaining = remaining.slice(splitAt).trim();
          }
          partial = remaining;
        }
        current = partial;
      }

      flush();
      return chunks;
    };

    // Only render categories with at least 1 surviving insight AND a non-zero quality score.
    const rendered = findings.filter(f => f.key_insights.length > 0 && f.relevance_score > 0);

    // Low-signal short-circuit: if fewer than 2 categories survived, don't spam the channel.
    const LOW_SIGNAL_THRESHOLD = 2;
    const lowSignal = rendered.length < LOW_SIGNAL_THRESHOLD;

    for (const f of rendered) {
      const emoji = emojiMap[f.category] || '📋';
      const score = f.relevance_score >= 0.65 ? '🟢' : '🟡';
      digestMessage += `${emoji} <b>${escapeHtml(f.title)}</b> ${score}\n`;
      for (const insight of f.key_insights.slice(0, 3)) {
        const truncated = insight.length > 140 ? insight.slice(0, 137) + '...' : insight;
        digestMessage += `  • ${escapeHtml(truncated)}\n`;
      }
      digestMessage += '\n';
    }

    const actionableCount = rendered.filter(f => f.relevance_score >= 0.65).length;
    if (lowSignal) {
      digestMessage = `🔬 <b>AI Research Digest — ${escapeHtml(dateStr)}</b>\n\n` +
        `<i>Low-signal day — only ${rendered.length}/${findings.length} categories returned verified intel. Digest suppressed; findings still stored for tuning.</i>`;
    } else {
      digestMessage += `📈 <b>Summary:</b> ${actionableCount}/${rendered.length} categories with verified intel (of ${findings.length} scanned)\n`;
    }
    if (whaleCrossRef.matched > 0) {
      digestMessage += `🐳 <b>Whale Cross-Ref:</b> ${whaleCrossRef.matched}/${whaleCrossRef.totalPicks} picks confirmed by Perplexity (${whaleCrossRef.boosted} boosted)\n`;
    }
    digestMessage += `🔗 Findings stored for strategy tuning`;

    // Send via Telegram (HTML parse mode)
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (botToken && chatId) {
      const rawChunks = splitTelegramMessage(digestMessage, TELEGRAM_SOFT_LIMIT);
      const chunks = rawChunks.length > 1
        ? rawChunks.map((chunk, index) => `<b>(${index + 1}/${rawChunks.length})</b>\n${chunk}`)
        : rawChunks;

      let allOk = true;
      for (const chunk of chunks) {
        if (chunk.length > TELEGRAM_LIMIT) {
          allOk = false;
          console.error('[Research Agent] Chunk exceeds Telegram limit');
          break;
        }

        let tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: chunk,
            parse_mode: 'HTML',
            disable_web_page_preview: true,
          }),
        });

        let tgResult = await tgResponse.json();

        if (!tgResponse.ok) {
          console.warn('[Research Agent] HTML send failed, retrying plain text:', tgResult?.description);
          tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: stripHtml(chunk),
              disable_web_page_preview: true,
            }),
          });
          tgResult = await tgResponse.json();
        }

        if (!tgResponse.ok) {
          allOk = false;
          console.error('[Research Agent] Telegram chunk failed:', tgResult?.description);
          break;
        }
      }

      console.log('[Research Agent] Telegram digest sent:', allOk);
    }

    console.log(`[Research Agent] Complete. ${findings.length} findings stored.`);

    return new Response(
      JSON.stringify({
        success: true,
        findingsCount: findings.length,
        actionableCount,
        whaleCrossRef: {
          totalPicks: whaleCrossRef.totalPicks,
          matched: whaleCrossRef.matched,
          boosted: whaleCrossRef.boosted,
        },
        findings: findings.map(f => ({
          category: f.category,
          title: f.title,
          insightsCount: f.key_insights.length,
          relevance: f.relevance_score,
        })),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[Research Agent] Error:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return new Response(
      JSON.stringify({ success: false, error: errorMessage }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
