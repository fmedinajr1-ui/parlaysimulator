import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
  Hr,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'ParlayFarm'
const TELEGRAM_BOT_URL = 'https://t.me/parlayiqbot'

interface Day7UpgradeProps {
  picksSent?: number
  picksWon?: number
  picksLost?: number
  pnlUnits?: number
  bestPick?: string
}

const Day7UpgradeEmail = ({
  picksSent = 7,
  picksWon = 5,
  picksLost = 2,
  pnlUnits = 2.4,
  bestPick = 'Anthony Edwards OVER 27.5 pts (-115) — hit at 34',
}: Day7UpgradeProps) => {
  const winRate = picksSent > 0 ? Math.round((picksWon / picksSent) * 100) : 0
  const pnlPositive = pnlUnits >= 0
  const pnlStr = pnlPositive ? `+${pnlUnits.toFixed(1)}u` : `${pnlUnits.toFixed(1)}u`

  return (
    <Html lang="en" dir="ltr">
      <Head />
      <Preview>Your 7-day recap: {picksWon}-{picksLost} ({pnlStr})</Preview>
      <Body style={main}>
        <Container style={container}>
          <Heading style={h1}>That's a wrap on your free week.</Heading>
          <Text style={tagline}>Here's how the bot did for you.</Text>

          <Section style={recapBox}>
            <div style={recapRow}>
              <div style={recapStat}>
                <Text style={recapNum}>{picksWon}-{picksLost}</Text>
                <Text style={recapLabel}>Record</Text>
              </div>
              <div style={recapStat}>
                <Text style={recapNum}>{winRate}%</Text>
                <Text style={recapLabel}>Win rate</Text>
              </div>
              <div style={recapStat}>
                <Text style={{ ...recapNum, color: pnlPositive ? '#22c55e' : '#ef4444' }}>{pnlStr}</Text>
                <Text style={recapLabel}>P&L</Text>
              </div>
            </div>
          </Section>

          <Heading as="h3" style={h3}>Best pick of the week</Heading>
          <Text style={text}>{bestPick}</Text>

          <Hr style={hr} />

          <Heading as="h2" style={h2}>Here's what you've been missing.</Heading>
          <Text style={text}>
            You got 1 free pick a day. Telegram subs get <strong>4–8 picks every day</strong>,
            plus the daily parlay slate, sharp money alerts, and the bot's full reasoning.
          </Text>

          <Text style={text}>
            $99/mo. Cancel anytime. No 3-day trial gimmicks — your free week was the trial.
          </Text>

          <Section style={{ textAlign: 'center' as const, margin: '24px 0' }}>
            <Button href={TELEGRAM_BOT_URL} style={cta}>
              Get the full bot on Telegram →
            </Button>
          </Section>

          <Text style={smallText}>
            Not ready? You'll keep getting 1 pick a week from us. No spam, just signal.
          </Text>

          <Text style={footer}>— The {SITE_NAME} Bot</Text>
        </Container>
      </Body>
    </Html>
  )
}

export const template = {
  component: Day7UpgradeEmail,
  subject: (data: Record<string, any>) => {
    const w = data?.picksWon ?? 0
    const l = data?.picksLost ?? 0
    return `Your 7-day recap: ${w}-${l}. Here's what's next.`
  },
  displayName: 'Day 7 upgrade CTA',
  previewData: {
    picksSent: 7,
    picksWon: 5,
    picksLost: 2,
    pnlUnits: 2.4,
    bestPick: 'Luka Dončić OVER 8.5 ast (-110) — hit at 12',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '28px', fontWeight: '800' as const, color: '#0a0a0a', margin: '0 0 8px' }
const h2 = { fontSize: '20px', fontWeight: '800' as const, color: '#0a0a0a', margin: '24px 0 12px' }
const h3 = { fontSize: '16px', fontWeight: '700' as const, color: '#0a0a0a', margin: '24px 0 8px' }
const tagline = { fontSize: '15px', color: '#525252', margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#262626', lineHeight: '1.6', margin: '0 0 12px' }
const smallText = { fontSize: '13px', color: '#737373', margin: '16px 0 0', textAlign: 'center' as const }
const recapBox = { backgroundColor: '#0a0a0a', borderRadius: '12px', padding: '24px', margin: '16px 0' }
const recapRow = { display: 'flex', justifyContent: 'space-around', textAlign: 'center' as const }
const recapStat = { flex: 1 }
const recapNum = { fontSize: '28px', fontWeight: '900' as const, color: '#ffffff', margin: '0', lineHeight: '1' }
const recapLabel = { fontSize: '11px', color: '#a3a3a3', margin: '6px 0 0', textTransform: 'uppercase' as const, letterSpacing: '1px' }
const cta = {
  backgroundColor: '#22c55e',
  color: '#0a0a0a',
  fontSize: '15px',
  fontWeight: '700' as const,
  padding: '14px 28px',
  borderRadius: '8px',
  textDecoration: 'none',
  display: 'inline-block',
}
const hr = { borderTop: '1px solid #e5e5e5', margin: '24px 0' }
const footer = { fontSize: '13px', color: '#737373', margin: '24px 0 0', textAlign: 'center' as const }
