/**
 * ai-research-agent
 * 
 * Daily AI research agent using Perplexity to gather intelligence on:
 * 1. Competing AI betting systems & strategies
 * 2. Advanced statistical models & edges
 * 3. Injury/lineup intel across sports
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
  // Extract bullet points or numbered items as key insights
  const lines = content.split('\n').filter(l => l.trim());
  const insights: string[] = [];
  
  for (const line of lines) {
    const trimmed = line.trim();
    // Match bullet points, numbered lists, or bold headers
    if (/^[-•*]\s/.test(trimmed) || /^\d+[.)]\s/.test(trimmed) || /^\*\*/.test(trimmed)) {
      const clean = trimmed.replace(/^[-•*\d.)]+\s*/, '').replace(/\*\*/g, '').trim();
      if (clean.length > 20 && clean.length < 500) {
        insights.push(clean);
      }
    }
  }
  
  return insights.slice(0, 10); // Cap at 10 insights per category
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
    const today = new Date().toISOString().split('T')[0];
    
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

    // Build Telegram digest
    const dateStr = new Date().toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'America/New_York',
    });

    let digestMessage = `🔬 *AI Research Digest - ${dateStr}*\n\n`;

    for (const f of findings) {
      const emoji = f.category === 'competing_ai' ? '🤖' :
                    f.category === 'statistical_models' ? '📊' :
                    f.category === 'ncaa_baseball_pitching' ? '⚾' :
                    f.category === 'weather_totals_impact' ? '🌬️' : '🏥';
      const score = f.relevance_score >= 0.65 ? '🟢' : f.relevance_score >= 0.40 ? '🟡' : '🔴';
      
      digestMessage += `${emoji} *${f.title}* ${score}\n`;
      
      // Show top 3 insights per category
      const topInsights = f.key_insights.slice(0, 3);
      if (topInsights.length > 0) {
        for (const insight of topInsights) {
          digestMessage += `  • ${insight.slice(0, 150)}\n`;
        }
      } else {
        digestMessage += `  _No actionable insights found_\n`;
      }
      digestMessage += '\n';
    }

    const actionableCount = findings.filter(f => f.relevance_score >= 0.65).length;
    digestMessage += `📈 *Summary:* ${actionableCount}/${findings.length} categories with actionable intel\n`;
    digestMessage += `🔗 Findings stored for strategy tuning`;

    // Send via bot-send-telegram pattern
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN');
    const chatId = Deno.env.get('TELEGRAM_CHAT_ID');

    if (botToken && chatId) {
      let tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: digestMessage,
          parse_mode: 'Markdown',
          disable_web_page_preview: true,
        }),
      });

      let tgResult = await tgResponse.json();

      // Fallback to plain text if Markdown fails
      if (!tgResponse.ok && tgResult?.description?.includes('parse')) {
        console.warn('[Research Agent] Markdown failed, retrying plain text');
        tgResponse = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: digestMessage.replace(/[*_`]/g, ''),
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
