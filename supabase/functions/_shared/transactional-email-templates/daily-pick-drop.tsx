import * as React from 'npm:react@18.3.1'
import {
  Body,
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

interface DailyPickDropProps {
  dripDay?: number
  playerName?: string
  propType?: string
  line?: number
  side?: string
  americanOdds?: number
  reasoning?: string
  confidencePct?: number
  accuracyPhrase?: string
  sport?: string
}

const formatOdds = (odds: number) => (odds > 0 ? `+${odds}` : `${odds}`)

const DailyPickDropEmail = ({
  dripDay = 1,
  playerName = 'Anthony Edwards',
  propType = 'Points',
  line = 27.5,
  side = 'OVER',
  americanOdds = -115,
  reasoning = 'Edwards is averaging 31.2 PPG over his last 10 vs. teams in the bottom-10 in defensive rating. Opponent is bottom-3.',
  confidencePct = 72,
  accuracyPhrase = 'Our model is hitting 67% on similar setups L30.',
  sport = 'NBA',
}: DailyPickDropProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Day {dripDay}/7: {playerName} {side} {line} {propType}</Preview>
    <Body style={main}>
      <Container style={container}>
        <Text style={dayBadge}>DAY {dripDay} OF 7 · FREE PICK</Text>
        <Heading style={h1}>Today's pick is locked.</Heading>

        <Section style={pickCard}>
          <Text style={sportTag}>{sport}</Text>
          <Heading as="h2" style={playerNameStyle}>{playerName}</Heading>
          <Text style={propLine}>
            <span style={sideTag}>{side}</span> {line} {propType}
          </Text>
          <Text style={oddsLine}>{formatOdds(americanOdds)} · {confidencePct}% confidence</Text>
        </Section>

        <Heading as="h3" style={h3}>Why we like it</Heading>
        <Text style={text}>{reasoning}</Text>

        <Text style={accuracyBadge}>📊 {accuracyPhrase}</Text>

        <Hr style={hr} />

        <Text style={smallText}>
          This is 1 of {7 - dripDay + 1} free picks left in your trial.
          On Telegram, our subs get 4–8 picks like this every day plus parlays.
        </Text>

        <Text style={footer}>— The {SITE_NAME} Bot</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: DailyPickDropEmail,
  subject: (data: Record<string, any>) => {
    const day = data?.dripDay ?? 1
    const player = data?.playerName ?? 'Today'
    return `Day ${day}/7: ${player} — your free pick is in`
  },
  displayName: 'Daily pick drop',
  previewData: {
    dripDay: 3,
    playerName: 'Luka Dončić',
    propType: 'Assists',
    line: 8.5,
    side: 'OVER',
    americanOdds: -110,
    reasoning: 'Luka is dishing 10.4 APG over his L10. Opponent allows the 4th-most assists to PGs.',
    confidencePct: 74,
    accuracyPhrase: 'Sharp assist Overs are hitting 71% L30.',
    sport: 'NBA',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '26px', fontWeight: '800' as const, color: '#0a0a0a', margin: '0 0 24px' }
const h3 = { fontSize: '16px', fontWeight: '700' as const, color: '#0a0a0a', margin: '24px 0 8px' }
const text = { fontSize: '14px', color: '#262626', lineHeight: '1.6', margin: '0 0 12px' }
const smallText = { fontSize: '13px', color: '#737373', margin: '0 0 12px', lineHeight: '1.5' }
const dayBadge = { fontSize: '11px', color: '#22c55e', fontWeight: '700' as const, letterSpacing: '1.5px', margin: '0 0 8px' }
const pickCard = {
  backgroundColor: '#0a0a0a',
  borderRadius: '12px',
  padding: '24px',
  textAlign: 'center' as const,
  margin: '16px 0',
}
const sportTag = { fontSize: '11px', color: '#a3a3a3', fontWeight: '700' as const, letterSpacing: '1.5px', margin: '0 0 8px' }
const playerNameStyle = { fontSize: '24px', fontWeight: '800' as const, color: '#ffffff', margin: '0 0 12px' }
const propLine = { fontSize: '20px', color: '#ffffff', margin: '0 0 8px', fontWeight: '600' as const }
const sideTag = { color: '#22c55e', fontWeight: '900' as const }
const oddsLine = { fontSize: '13px', color: '#a3a3a3', margin: '0', letterSpacing: '0.5px' }
const accuracyBadge = {
  fontSize: '13px',
  color: '#0a0a0a',
  backgroundColor: '#dcfce7',
  padding: '10px 14px',
  borderRadius: '6px',
  margin: '16px 0',
  fontWeight: '600' as const,
}
const hr = { borderTop: '1px solid #e5e5e5', margin: '24px 0' }
const footer = { fontSize: '13px', color: '#737373', margin: '24px 0 0' }
