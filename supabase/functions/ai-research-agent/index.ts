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
    query: 'What are the latest AI sports betting prediction systems and models being used in 2026? What strategies and accuracy rates are they reporting? Include any public leaderboards or tracked records.',
    systemPrompt: 'You are a sports analytics researcher. Focus on AI/ML betting systems, their claimed accuracy, methodologies, and any verifiable track records. Be specific about models, accuracy percentages, and strategies.',
  },
  {
    category: 'statistical_models',
    query: 'What are the most effective statistical approaches for NBA and NHL player prop predictions in 2026? Include Bayesian methods, Kelly criterion applications, sharp money detection, and any new quantitative edges discovered recently.',
    systemPrompt: 'You are a quantitative sports analyst. Focus on actionable statistical methods, calibration techniques, and mathematical edges. Include specific formulas or thresholds when available.',
  },
  {
    category: 'injury_intel',
    query: 'What are today\'s latest NBA and NHL injury reports, lineup changes, rest days, and load management decisions? Include any surprise scratches or returns from injury.',
    systemPrompt: 'You are a sports injury analyst. Provide the most current injury updates with specific player names, teams, and expected impact on games. Focus on information that would affect player props.',
  },
  {
    category: 'ncaa_baseball_pitching',
    query: "What are today's NCAA college baseball probable starting pitchers for the major conferences (SEC, ACC, Big 12, Big Ten, Pac-12)? Include each starter's season ERA, WHIP, last 3 game logs, and any pitch count or injury concerns. Also note any bullpen arms that are unavailable due to recent heavy usage.",
    systemPrompt: 'You are a college baseball pitching analyst. Provide specific pitcher names, teams, ERAs, WHIPs, and recent performance trends. Flag any starters on short rest or with declining velocity. Focus on data that would affect game totals and run lines.',
  },
  {
    category: 'weather_totals_impact',
    query: "What is today's weather forecast for major NCAA college baseball games? Include temperature, wind speed and direction relative to the field, humidity, and any rain delays expected. Which ballparks are known as hitter-friendly or pitcher-friendly? How does today's weather historically affect over/under totals?",
    systemPrompt: 'You are a sports weather analyst specializing in baseball. Quantify how weather conditions affect run scoring. Cite specific thresholds (e.g., wind >10mph blowing out adds ~1.5 runs). Include park factors and altitude effects. Be specific about which games are most impacted.',
  },
  {
    category: 'ncaab_team_scoring_trends',
    query: "For each NCAA college basketball game today, provide: 1) Each team's last 5 game scores and results (wins/losses with exact scores), 2) Average points scored and allowed per game over their last 5 games, 3) Whether the game pace is fast or slow based on recent games, 4) Whether the total is likely to go OVER or UNDER based on recent scoring trends. Focus on today's key matchups including: Indiana vs Illinois, South Florida vs Florida Atlantic, Utah vs Cincinnati, Bradley vs Southern Illinois, Iona vs Niagara, Rutgers vs Maryland, Charlotte vs UTSA.",
    systemPrompt: 'You are a college basketball scoring trends analyst. For EACH team in today\'s games, provide their exact scores from their last 5 games (e.g., "Indiana: W 78-65, L 62-70, W 85-72..."). Calculate the combined scoring average for each matchup. Compare to posted totals. Flag games where recent scoring suggests the total is too high or too low. Be specific with numbers — no vague statements. This data will be used to validate over/under picks.',
  },
  {
    category: 'ncaab_scoring_validation',
    query: "For these specific NCAAB games today: Indiana vs Illinois, South Florida vs Florida Atlantic, Utah vs Cincinnati, Bradley vs Southern Illinois, Iona vs Niagara, Rutgers vs Maryland. For each team, what were their exact scores in their last 3 games? What is the combined scoring average for each matchup? Which games are trending OVER based on high-scoring recent games? Which games are trending UNDER based on defensive battles? Flag any game where the posted total seems inflated compared to recent performance.",
    systemPrompt: 'You are a sports data analyst validating over/under totals. For each team provide: 1) Last 3 game scores (exact), 2) Points per game average last 3, 3) Points allowed per game last 3, 4) Combined matchup projected total based on recent scoring. Be precise with numbers. Flag any total that seems 8+ points too high or too low vs recent performance. This data prevents blind OVER picks.',
  },
  {
    category: 'ncaab_injury_lineups',
    query: "What are today's latest NCAA college basketball injury reports, suspensions, and starting lineup changes for major conference games (Big 12, SEC, ACC, Big Ten, Big East, AAC)? Include any surprise DNPs, players returning from injury, and key rotation changes. Which games are most impacted by missing starters?",
    systemPrompt: 'You are an NCAAB injury and lineup analyst. Provide specific player names, their statistical impact (PPG, RPG, APG), and how their absence or return affects spread and total projections. Flag games where a missing starter shifts the line by 2+ points.',
  },
  {
    category: 'ncaab_sharp_signals',
    query: "What are today's sharpest NCAA college basketball betting signals? Include significant line movements (3+ points), reverse line movement, steam moves, and where professional bettors are loading. Which NCAAB spreads and totals have the most lopsided sharp action? Are there any contrarian plays where the public is heavily on one side but sharps are on the other?",
    systemPrompt: 'You are a sports betting market analyst specializing in college basketball. Focus on quantifiable sharp signals: opening vs current lines, handle percentages, ticket splits, and steam move timestamps. Distinguish between sharp money and public money. Cite specific line movements and percentages.',
  },
  {
    category: 'nba_nhl_sharp_signals',
    query: "What are today's sharpest NBA and NHL betting signals? Include: 1) Significant line movements (1.5+ points for spreads, 3+ for totals), 2) Reverse line movement where the line moves opposite of ticket percentages, 3) Steam moves on specific player props (points, assists, rebounds, shots, saves), 4) Where professional/whale bettors are loading heaviest, 5) Any props where books have moved the line 1+ point since open. Focus on tonight's games only.",
    systemPrompt: 'You are an elite sports betting market analyst who tracks whale money and sharp action in NBA and NHL. Provide specific: player names, prop types, opening vs current lines, direction of movement, and ticket vs money splits. Quantify everything — e.g., "LeBron PTS opened at 25.5, now 27.5 with 70% money on UNDER despite 60% tickets on OVER." Flag steam moves with timestamps when available. Distinguish between sharp syndicate action and public squares.',
  },
  {
    category: 'value_line_discrepancies',
    query: "Which NBA, NHL, and NCAAB games today have the biggest discrepancies between consensus model projections (ESPN BPI, KenPom, FiveThirtyEight, Sagarin, Massey, numberFire) and current sportsbook lines? Look for: 1) Spreads where models disagree with books by 3+ points, 2) Totals where projections differ by 5+ points from the posted line, 3) Moneyline odds where implied probability diverges 10%+ from model predictions. Include specific numbers for each discrepancy.",
    systemPrompt: 'You are a quantitative betting analyst who compares public consensus models against sportsbook lines. For each discrepancy: cite the model name, its projection, the current book line, and the gap. Rank discrepancies by magnitude. E.g., "KenPom projects Duke 78 vs UNC 72 (Duke -6), but books have Duke -2.5 = 3.5-point value on Duke." Focus on actionable value plays with the highest edge.',
  },
  {
    category: 'situational_spots',
    query: "What are today's strongest situational betting angles for NBA, NHL, and NCAAB? Look for: 1) LETDOWN spots — teams coming off big emotional wins (rivalries, buzzer beaters, upsets) now facing lesser opponents, 2) REVENGE games — teams facing an opponent that beat them earlier this season, especially by a large margin, 3) TRAVEL/FATIGUE — teams on 3+ game road trips, back-to-backs, or 3-in-4-nights, especially crossing time zones, 4) LOOKAHEAD — teams with a marquee matchup in 2 days who may overlook tonight's opponent, 5) SCHEDULING — any team playing their 4th game in 6 days.",
    systemPrompt: 'You are a sports betting situational analyst. For each spot: name the teams, cite the specific situation (e.g., "Lakers won a buzzer-beater vs Celtics last night, now face Hornets"), quantify the historical ATS record for that situation type (e.g., "NBA teams in letdown spots are 42-58 ATS historically"), and recommend spread/total/ML direction. Focus on spots with the strongest historical edge. Be specific about game times and whether the team is home or away.',
  },
  {
    category: 'tennis_sharp_signals',
    query: "Today's sharpest ATP/WTA tennis betting signals — line movements on match winners, set totals, game spreads. Where is professional money loading? Any steam moves on specific matches? Include surface-specific edges (hard court, clay, grass). Which matches have the biggest line moves since open?",
    systemPrompt: 'You are a tennis betting market analyst. Extract specific player names, match odds movements, surface factors, and sharp/public money splits. For each signal provide: player name, opponent, direction (favorite/underdog, over/under on games), and magnitude of line movement. Be specific about which surface the match is on.',
  },
  {
    category: 'tennis_form_matchups',
    query: "Today's ATP/WTA tennis matches — player recent form (last 5-10 matches), head-to-head records, surface win rates, fatigue from recent tournaments, any injury concerns or withdrawals. Which favorites are vulnerable? Which underdogs have strong surface-specific records? Flag any player playing their 3rd+ match in 5 days.",
    systemPrompt: 'You are a tennis matchup analyst. Provide win/loss records, surface-specific stats, H2H records, and flag players on fatigue (3+ matches in last 5 days) or returning from injury. For each player mention: name, recent form (W/L last 5), surface win rate if relevant, and any fatigue/injury flags. Clearly label hot streaks (4+ wins) and cold streaks (3+ losses).',
  },
  {
    category: 'table_tennis_signals',
    query: "Today's international table tennis matches and betting signals. Include ITTF events, WTT events, and major league matches. Any sharp line movements on match winners or total games? Which players are in strong form or dealing with fatigue from back-to-back tournaments? Flag players on 3+ match days.",
    systemPrompt: 'You are a table tennis betting analyst. Focus on player form, recent results, head-to-head records, and any sharp money signals. Table tennis has high volume and fast turnover — flag players on 3+ match days as fatigued. Provide specific player names, event names, and directional bias (favorite/underdog, over/under on games).',
  },
];

async function queryPerplexity(
  apiKey: string,
  query: string,
  systemPrompt: string
): Promise<{ content: string; citations: string[] }> {
  const response = await fetch('https://api.perplexity.ai/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'sonar',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: query },
      ],
      search_recency_filter: 'day',
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Perplexity API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  return {
    content: data.choices?.[0]?.message?.content || '',
    citations: data.citations || [],
  };
}

function extractInsights(content: string): string[] {
  const lines = content.split('\n').filter(l => l.trim());
  const insights: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-•*]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed) || /^\*\*/.test(trimmed)) {
      const clean = trimmed.replace(/^[-•*\d.)]+\s*/, '').replace(/\*\*/g, '').trim();
      if (clean.length > 20 && clean.length < 500) {
        insights.push(clean);
      }
    }
  }
  
  return insights.slice(0, 10);
}

/** Escape text for Telegram HTML parse mode */
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

    if (existingCount && existingCount > 0) {
      console.log(`[Research Agent] Already ran today (${existingCount} findings exist for ${today}). Skipping.`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, reason: `Already ran today — ${existingCount} findings exist for ${today}` }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
        };

        findings.push({
          category: rq.category,
          title: titleMap[rq.category] || rq.category,
          summary: result.content.slice(0, 2000),
          key_insights: insights,
          sources: result.citations.slice(0, 5),
          relevance_score: insights.length > 5 ? 0.85 : insights.length > 2 ? 0.65 : 0.40,
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
      .insert(inserts);

    if (insertError) {
      console.error('[Research Agent] Insert error:', insertError);
    }

    // === BUILD TELEGRAM DIGEST (HTML mode, capped at 4000 chars) ===
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
    };

    let digestMessage = `🔬 <b>AI Research Digest — ${escapeHtml(dateStr)}</b>\n\n`;

    for (const f of findings) {
      const emoji = emojiMap[f.category] || '📋';
      const score = f.relevance_score >= 0.65 ? '🟢' : f.relevance_score >= 0.40 ? '🟡' : '🔴';

      digestMessage += `${emoji} <b>${escapeHtml(f.title)}</b> ${score}\n`;

      const topInsights = f.key_insights.slice(0, 3);
      if (topInsights.length > 0) {
        for (const insight of topInsights) {
          const truncated = insight.length > 120 ? insight.slice(0, 117) + '...' : insight;
          digestMessage += `  • ${escapeHtml(truncated)}\n`;
        }
      } else {
        digestMessage += `  <i>No actionable insights found</i>\n`;
      }
      digestMessage += '\n';

      // Truncate early if approaching limit
      if (digestMessage.length > 3600) {
        digestMessage += `⚠️ <i>Truncated — too many categories. View full report in dashboard.</i>\n`;
        break;
      }
    }

    const actionableCount = findings.filter(f => f.relevance_score >= 0.65).length;
    digestMessage += `📈 <b>Summary:</b> ${actionableCount}/${findings.length} categories with actionable intel\n`;
    digestMessage += `🔗 Findings stored for strategy tuning`;

    // Hard cap at 4000 chars (Telegram limit is 4096)
    if (digestMessage.length > 4000) {
      digestMessage = digestMessage.slice(0, 3950) + '\n\n⚠️ <i>Message truncated</i>';
    }

    // Send via Telegram (HTML parse mode)
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (botToken && chatId) {
      let tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: digestMessage,
          parse_mode: 'HTML',
          disable_web_page_preview: true,
        }),
      });

      let tgResult = await tgResponse.json();

      // Fallback to plain text if HTML still fails for some reason
      if (!tgResponse.ok) {
        console.warn('[Research Agent] HTML send failed, retrying plain text:', tgResult?.description);
        tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: digestMessage.replace(/<[^>]+>/g, ''),
            disable_web_page_preview: true,
          }),
        });
        tgResult = await tgResponse.json();
      }

      console.log('[Research Agent] Telegram digest sent:', tgResponse.ok);
    }

    console.log(`[Research Agent] Complete. ${findings.length} findings stored.`);

    return new Response(
      JSON.stringify({
        success: true,
        findingsCount: findings.length,
        actionableCount,
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
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
