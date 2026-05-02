import * as React from 'npm:react@18.3.1'
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Section,
  Text,
} from 'npm:@react-email/components@0.0.22'
import type { TemplateEntry } from './registry.ts'

const SITE_NAME = 'ParlayIQ'
const TELEGRAM_BOT_URL = 'https://t.me/parlayiqbot'

interface BotAccessProps {
  password?: string | null
  tier?: string
}

const tierLabel = (tier?: string) => {
  if (tier === 'kennel_club') return 'Kennel Club'
  if (tier === 'top_dog') return 'Top Dog'
  if (tier === 'pup') return 'The Pup'
  return 'ParlayIQ'
}

const BotAccessEmail = ({ password, tier }: BotAccessProps) => (
  <Html lang="en" dir="ltr">
    <Head />
    <Preview>Your {SITE_NAME} bot access is ready — activate in 10 seconds</Preview>
    <Body style={main}>
      <Container style={container}>
        <Section style={header}>
          <Text style={badge}>🤖 BOT ACCESS ACTIVATED</Text>
          <Heading style={h1}>Welcome to {tierLabel(tier)}</Heading>
          <Text style={subhead}>Your subscription is live</Text>
        </Section>

        <Section style={body}>
          <Text style={text}>
            Welcome aboard! Your subscription has been confirmed and your {SITE_NAME} Bot is ready to use.
          </Text>
          <Text style={text}>
            Activation takes 10 seconds — open Telegram and send the bot the command below.
          </Text>

          {password ? (
            <Section style={codeBox}>
              <Text style={codeLabel}>SEND THIS IN TELEGRAM</Text>
              <Text style={codeText}>/start {password}</Text>
              <Text style={codeNote}>One-time code · works for one Telegram account only</Text>
            </Section>
          ) : null}

          <Section style={{ textAlign: 'center', margin: '0 0 28px' }}>
            <Button href={TELEGRAM_BOT_URL} style={button}>
              Open {SITE_NAME} Bot on Telegram →
            </Button>
          </Section>

          <Section style={infoBox}>
            <Text style={infoTitle}>WHAT YOU GET</Text>
            <Text style={infoItem}>• Daily AI-generated parlay picks</Text>
            <Text style={infoItem}>• Real-time alerts via Telegram</Text>
            <Text style={infoItem}>• Multi-sport coverage (NBA, NFL, MLB, NHL)</Text>
            <Text style={infoItem}>• Confidence scores & reasoning for every pick</Text>
          </Section>

          <Hr style={hr} />
          <Text style={footer}>
            Questions? Just reply to this email and we'll help you get started.
          </Text>
        </Section>
      </Container>
    </Body>
  </Html>
)

export const template = {
  component: BotAccessEmail,
  subject: '🤖 Your ParlayIQ Bot Access is Ready',
  displayName: 'Bot access welcome',
  previewData: { password: 'sample-code-123', tier: 'top_dog' },
} satisfies TemplateEntry

const main = {
  backgroundColor: '#ffffff',
  fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif',
  margin: '0',
  padding: '0',
}
const container = {
  maxWidth: '600px',
  margin: '0 auto',
  padding: '24px 16px',
}
const header = {
  background: 'linear-gradient(135deg,#16a34a,#15803d)',
  borderRadius: '12px 12px 0 0',
  padding: '36px 32px 28px',
  textAlign: 'center' as const,
}
const badge = {
  margin: '0 0 8px',
  color: '#bbf7d0',
  fontSize: '12px',
  fontWeight: '700',
  letterSpacing: '1.5px',
}
const h1 = {
  margin: '0',
  color: '#ffffff',
  fontSize: '26px',
  fontWeight: '700',
  letterSpacing: '-0.5px',
}
const subhead = {
  margin: '8px 0 0',
  color: '#bbf7d0',
  fontSize: '14px',
}
const body = {
  backgroundColor: '#0a0a0a',
  borderRadius: '0 0 12px 12px',
  padding: '32px 32px 28px',
}
const text = {
  margin: '0 0 18px',
  color: '#d1d5db',
  fontSize: '15px',
  lineHeight: '1.6',
}
const codeBox = {
  backgroundColor: '#000000',
  border: '1px dashed #16a34a',
  borderRadius: '8px',
  padding: '18px 20px',
  margin: '0 0 24px',
  textAlign: 'center' as const,
}
const codeLabel = {
  margin: '0 0 6px',
  color: '#4ade80',
  fontSize: '11px',
  fontWeight: '700',
  letterSpacing: '1px',
}
const codeText = {
  margin: '0',
  color: '#ffffff',
  fontSize: '18px',
  fontWeight: '700',
  fontFamily: '"SF Mono",Menlo,Consolas,monospace',
  letterSpacing: '1px',
}
const codeNote = {
  margin: '8px 0 0',
  color: '#6b7280',
  fontSize: '12px',
}
const button = {
  backgroundColor: '#16a34a',
  color: '#ffffff',
  fontSize: '16px',
  fontWeight: '700',
  textDecoration: 'none',
  padding: '14px 32px',
  borderRadius: '8px',
  display: 'inline-block',
}
const infoBox = {
  backgroundColor: '#0d2818',
  border: '1px solid #166534',
  borderRadius: '8px',
  padding: '18px 22px',
  margin: '0 0 8px',
}
const infoTitle = {
  margin: '0 0 8px',
  color: '#4ade80',
  fontSize: '12px',
  fontWeight: '700',
  letterSpacing: '0.5px',
}
const infoItem = {
  margin: '4px 0',
  color: '#d1d5db',
  fontSize: '14px',
  lineHeight: '1.6',
}
const hr = {
  borderColor: '#1f1f1f',
  margin: '24px 0 16px',
}
const footer = {
  margin: '0',
  color: '#6b7280',
  fontSize: '13px',
  lineHeight: '1.6',
}
