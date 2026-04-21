// Free Slip Grader edge function — public endpoint
// Returns letter grade + brutal headline + per-leg breakdown
import { createClient } from 'npm:@supabase/supabase-js@2'
import { renderSlipVerdict, type SlipLeg, type LegStatus } from '../_shared/parlayfarm-format.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface Leg {
  description?: string
  odds?: string | number
  player?: string
  propType?: string
  line?: number
  side?: string
}

// American odds → implied probability
function americanToProb(odds: number): number {
  if (!odds || isNaN(odds)) return 0.5
  return odds > 0 ? 100 / (odds + 100) : Math.abs(odds) / (Math.abs(odds) + 100)
}

function parseOdds(o: string | number | undefined): number {
  if (typeof o === 'number') return o
  if (!o) return -110
  const cleaned = String(o).replace(/[^\d\-+]/g, '')
  const n = parseInt(cleaned, 10)
  return isNaN(n) ? -110 : n
}

// Tiered headline pools
const HEADLINES: Record<string, string[]> = {
  A: [
    "This is sharp. We'd actually tail this one.",
    "Clean build. The market hasn't caught up to these.",
    "Disciplined picks, real edges. Respect.",
  ],
  B: [
    "Solid foundation, one or two questionable legs holding it back.",
    "Good instincts, but the variance is creeping up.",
    "Almost. Trim the fat and this is a winner.",
  ],
  C: [
    "This is a coin flip wearing a tuxedo.",
    "The math says maybe. The vibes say nope.",
    "You're betting on hope, not edge.",
  ],
  D: [
    "Books are licking their chops on this one.",
    "Pure variance. You'd do better picking on a dartboard.",
    "Each leg is a question mark. Together they're a disaster.",
  ],
  F: [
    "This parlay is a donation receipt.",
    "Books pay rent on slips like this.",
    "Five legs of bad ideas don't make a good idea.",
    "We've seen better picks from a magic 8-ball.",
  ],
}

function pickHeadline(grade: string): string {
  const pool = HEADLINES[grade] || HEADLINES.C
  return pool[Math.floor(Math.random() * pool.length)]
}

function gradeLeg(leg: Leg, allLegs: Leg[]): { score: number; verdict: string; fix?: string } {
  const odds = parseOdds(leg.odds)
  const prob = americanToProb(odds)

  // Same-game correlation flag
  const sameGame = allLegs.filter(l => l !== leg && l.player && leg.player &&
    l.player.split(' ').slice(-1)[0] === leg.player.split(' ').slice(-1)[0]).length > 0

  let score = prob * 100
  let verdict = ''
  let fix: string | undefined

  if (prob >= 0.7) {
    verdict = `Heavy chalk (${(prob * 100).toFixed(0)}% implied). Low-payout filler.`
  } else if (prob >= 0.55) {
    verdict = `Reasonable (${(prob * 100).toFixed(0)}% implied). Defensible leg.`
    score += 5
  } else if (prob >= 0.45) {
    verdict = `Coinflip (${(prob * 100).toFixed(0)}% implied). Hope, not edge.`
    fix = 'Replace with a sharper sub-(-150) favorite.'
  } else {
    verdict = `Long-shot (${(prob * 100).toFixed(0)}% implied). The book wants this.`
    score -= 15
    fix = 'Drop this leg or move to a tighter line.'
  }

  if (sameGame) {
    verdict += ' ⚠️ Same-game correlation detected.'
    score -= 8
  }

  return { score: Math.max(0, Math.min(100, score)), verdict, fix }
}

function letterGrade(composite: number): string {
  if (composite >= 75) return 'A'
  if (composite >= 60) return 'B'
  if (composite >= 45) return 'C'
  if (composite >= 30) return 'D'
  return 'F'
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  try {
    const { legs } = await req.json() as { legs: Leg[] }
    if (!Array.isArray(legs) || legs.length === 0) {
      return new Response(JSON.stringify({ error: 'legs array required' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    const legResults = legs.map(l => gradeLeg(l, legs))
    const avgLegScore = legResults.reduce((s, r) => s + r.score, 0) / legResults.length

    // Leg-count penalty: more legs = harder to hit
    const legPenalty = Math.max(0, (legs.length - 3) * 6)
    const composite = Math.max(0, Math.min(100, avgLegScore - legPenalty))
    const grade = letterGrade(composite)
    const headline = pickHeadline(grade)

    const breakdown = legs.map((leg, i) => ({
      leg: leg.description || `${leg.player ?? 'Leg'} ${leg.side ?? ''} ${leg.line ?? ''} ${leg.propType ?? ''}`.trim(),
      odds: leg.odds,
      verdict: legResults[i].verdict,
      fix: legResults[i].fix,
      score: Math.round(legResults[i].score),
    }))

    const fixSuggestion = legs.length > 3
      ? `Drop the ${legResults.filter(r => r.score < 50).length} weakest legs and reduce to a 2-3 leg build.`
      : grade === 'F' || grade === 'D'
        ? 'Replace the long-shots with sub-(-150) favorites or drop entirely.'
        : 'Tighten one leg and you have a real ticket.'

    // Log anonymous event
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )
    const shareCardId = crypto.randomUUID()
    await supabase.from('grade_events').insert({
      letter_grade: grade,
      leg_count: legs.length,
      composite_score: composite,
      share_card_id: shareCardId,
      email_captured: false,
      metadata: { headline },
    })

    return new Response(JSON.stringify({
      letter_grade: grade,
      headline,
      composite_score: Math.round(composite),
      breakdown,
      fix_suggestion: fixSuggestion,
      share_card_id: shareCardId,
      telegram: (() => {
        const verdict = grade === 'A' || grade === 'B' ? 'TOP DOG' : grade === 'F' ? 'TRAP' : 'MIXED';
        const tagline = grade === 'A' || grade === 'B' ? 'tail it' : grade === 'F' ? 'fade it' : 'keep with swaps';
        const tgLegs: SlipLeg[] = legs.map((leg, i) => {
          const score = legResults[i].score;
          const status: LegStatus = score >= 65 ? 'green' : score >= 45 ? 'yellow' : 'red';
          return { status, text: breakdown[i].leg, note: legResults[i].fix ?? legResults[i].verdict.split('.')[0] };
        });
        return renderSlipVerdict({
          slipId: shareCardId,
          legCount: legs.length,
          book: 'Slip',
          stake: '—',
          payout: '—',
          verdict,
          verdictTagline: tagline,
          score: composite,
          legs: tgLegs,
          sharperPlayLines: [fixSuggestion, headline],
        });
      })(),
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('grade-slip error', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
