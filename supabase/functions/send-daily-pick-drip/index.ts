// Daily pick drip — runs at 11 AM ET via cron
// Sends 1 free pick per day for 7 days, then upgrade CTA
import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DAILY_SEND_CAP = 100 // warm-up cap

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    // Get top free pick of the day
    const today = new Date().toISOString().slice(0, 10)
    const { data: picks } = await supabase
      .from('bot_daily_picks')
      .select('player_name, sport, prop_type, line, side, confidence, edge_pct, reasoning, american_odds')
      .eq('pick_date', today)
      .in('status', ['active', 'pending', 'live'])
      .order('confidence', { ascending: false })
      .limit(1)

    const topPick = picks?.[0]

    // Get eligible subscribers (drip_day < 7, not paused, not unsubscribed)
    const { data: subs, error: subsError } = await supabase
      .from('email_subscribers')
      .select('id, email, drip_day')
      .lt('drip_day', 7)
      .eq('drip_paused', false)
      .is('unsubscribed_at', null)
      .eq('is_subscribed', true)
      .order('subscribed_at', { ascending: true })
      .limit(DAILY_SEND_CAP)

    if (subsError) throw subsError

    const results: any[] = []
    for (const sub of subs ?? []) {
      const nextDay = (sub.drip_day ?? 0) + 1
      const isDay7 = nextDay >= 7
      const templateName = isDay7 ? 'day-7-upgrade' : 'daily-pick-drop'

      let templateData: Record<string, any> = { dripDay: nextDay }
      if (!isDay7 && topPick) {
        const reasoningText = typeof topPick.reasoning === 'string'
          ? topPick.reasoning
          : (topPick.reasoning?.summary || topPick.reasoning?.text || JSON.stringify(topPick.reasoning).slice(0, 240))
        templateData = {
          dripDay: nextDay,
          playerName: topPick.player_name,
          sport: topPick.sport,
          propType: topPick.prop_type,
          line: Number(topPick.line),
          side: topPick.side,
          americanOdds: Number(topPick.american_odds ?? -110),
          reasoning: reasoningText,
          confidencePct: Math.round(Number(topPick.confidence ?? 0)),
          accuracyPhrase: `Edge: ${Number(topPick.edge_pct ?? 0).toFixed(1)}%`,
        }
      }

      const { error: sendError } = await supabase.functions.invoke('send-transactional-email', {
        body: {
          templateName,
          recipientEmail: sub.email,
          idempotencyKey: `drip-${sub.id}-day-${nextDay}-${today}`,
          templateData,
        },
      })

      if (!sendError) {
        await supabase
          .from('email_subscribers')
          .update({ drip_day: nextDay, last_drip_sent_at: new Date().toISOString() })
          .eq('id', sub.id)
        results.push({ email: sub.email, day: nextDay, ok: true })
      } else {
        results.push({ email: sub.email, day: nextDay, ok: false, error: sendError.message })
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: results.length,
      pick_used: topPick?.player_name ?? null,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (err) {
    console.error('send-daily-pick-drip error', err)
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
