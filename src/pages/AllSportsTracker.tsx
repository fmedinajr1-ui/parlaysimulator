import { Helmet } from 'react-helmet';
import { AllSportsTracker } from '@/components/tracker/AllSportsTracker';
import { AppShell } from '@/components/layout/AppShell';

export default function AllSportsTrackerPage() {
  return (
    <AppShell>
      <Helmet>
        <title>All-Sports Engine Tracker | Live Picks from All Engines</title>
        <meta 
          name="description" 
          content="Real-time picks from all 8 betting engines - Sharp Money, God Mode, Juiced Props, HitRate, Fatigue, AI Parlay, FanDuel Traps, and Unified Props." 
        />
      </Helmet>
      <AllSportsTracker />
    </AppShell>
  );
}
