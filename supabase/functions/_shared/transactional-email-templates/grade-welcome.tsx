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

interface GradeWelcomeProps {
  letterGrade?: string
  headline?: string
  legCount?: number
  breakdown?: string[]
  fixSuggestion?: string
}

const GradeWelcomeEmail = ({
  letterGrade = 'F',
  headline = 'This parlay is a coin flip wearing a tuxedo.',
  legCount = 4,
  breakdown = [
    'Leg 1: Low edge, sharp money is on the other side.',
    'Leg 2: Correlated with Leg 4 — boosts variance.',
    'Leg 3: Decent. The only one we like.',
    'Leg 4: Public trap. Books are inviting you in.',
  ],
  fixSuggestion = 'Drop legs 1 and 4. Add a sharp single from our daily pick.',
}: GradeWelcomeProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your slip got a {letterGrade}. Here's why.</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>Your slip got a {letterGrade}.</Heading>
        <Text style={tagline}>{headline}</Text>

        <Section style={gradeBox}>
          <Text style={gradeLetter}>{letterGrade}</Text>
          <Text style={gradeSub}>{legCount}-leg parlay</Text>
        </Section>

        <Heading as="h2" style={h2}>The breakdown</Heading>
        {breakdown.map((line, i) => (
          <Text key={i} style={bulletText}>• {line}</Text>
        ))}

        <Hr style={hr} />

        <Heading as="h2" style={h2}>How to fix it</Heading>
        <Text style={text}>{fixSuggestion}</Text>

        <Hr style={hr} />

        <Section style={ctaBox}>
          <Heading as="h3" style={h3}>Want a free pick every day?</Heading>
          <Text style={text}>
            We'll send you our top single pick every morning for the next 7 days. No catch.
            On day 7, if you like what you're seeing, the full Telegram bot is $99/mo.
          </Text>
          <Text style={smallText}>
            Watch your inbox tomorrow at 11 AM ET.
          </Text>
        </Section>

        <Text style={footer}>— The {SITE_NAME} Bot</Text>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: GradeWelcomeEmail,
  subject: (data: Record<string, any>) =>
    `Your slip got a ${data?.letterGrade ?? 'grade'}. Here's why.`,
  displayName: 'Grade welcome + breakdown',
  previewData: {
    letterGrade: 'D',
    headline: 'This is a parlay that hates you back.',
    legCount: 5,
    breakdown: [
      'Leg 1: Sharp money fading. We agree.',
      'Leg 2: Correlated with Leg 5.',
      'Leg 3: Coin flip. Not edge.',
      'Leg 4: The only one we like.',
      'Leg 5: Public trap.',
    ],
    fixSuggestion: 'Trim to legs 3 and 4 only. Add today\'s top sharp single.',
  },
} satisfies TemplateEntry

const main = { backgroundColor: '#ffffff', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }
const container = { padding: '32px 24px', maxWidth: '560px', margin: '0 auto' }
const h1 = { fontSize: '28px', fontWeight: '800' as const, color: '#0a0a0a', margin: '0 0 8px' }
const h2 = { fontSize: '18px', fontWeight: '700' as const, color: '#0a0a0a', margin: '24px 0 12px' }
const h3 = { fontSize: '16px', fontWeight: '700' as const, color: '#0a0a0a', margin: '0 0 8px' }
const tagline = { fontSize: '15px', color: '#525252', fontStyle: 'italic' as const, margin: '0 0 24px' }
const text = { fontSize: '14px', color: '#262626', lineHeight: '1.6', margin: '0 0 12px' }
const bulletText = { fontSize: '14px', color: '#262626', lineHeight: '1.6', margin: '0 0 6px' }
const smallText = { fontSize: '13px', color: '#737373', margin: '12px 0 0' }
const gradeBox = {
  backgroundColor: '#0a0a0a',
  borderRadius: '12px',
  padding: '24px',
  textAlign: 'center' as const,
  margin: '16px 0',
}
const gradeLetter = { fontSize: '64px', fontWeight: '900' as const, color: '#22c55e', margin: '0', lineHeight: '1' }
const gradeSub = { fontSize: '13px', color: '#a3a3a3', margin: '8px 0 0', textTransform: 'uppercase' as const, letterSpacing: '1px' }
const ctaBox = { backgroundColor: '#f5f5f5', borderRadius: '8px', padding: '20px', margin: '24px 0' }
const hr = { borderTop: '1px solid #e5e5e5', margin: '24px 0' }
const footer = { fontSize: '13px', color: '#737373', margin: '24px 0 0' }
