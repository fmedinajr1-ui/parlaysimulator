import { Helmet } from 'react-helmet';
import { TeamBetsDashboard } from '@/components/team-bets/TeamBetsDashboard';
import { AppShell } from '@/components/layout/AppShell';

export default function TeamBetsPage() {
  return (
    <AppShell>
      <Helmet>
        <title>Team Bets | Spreads, Totals & Moneylines</title>
        <meta 
          name="description" 
          content="Sharp money signals for team props - spreads, totals, and moneylines across NBA, NHL, NFL, and more." 
        />
      </Helmet>
      <TeamBetsDashboard />
    </AppShell>
  );
}
