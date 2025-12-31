import { LiveBettingDashboard } from '@/components/live/LiveBettingDashboard';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { Radio } from 'lucide-react';

export default function LiveDashboard() {
  return (
    <div className="min-h-screen bg-background pb-24">
      <MobileHeader
        title="Live Dashboard"
        subtitle="Track your pending parlays in real-time"
        showBack
        backTo="/"
        showLogo={false}
        icon={
          <div className="relative">
            <Radio className="w-5 h-5 text-primary" />
            <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
          </div>
        }
      />
      <main className="container mx-auto px-4 py-6">
        <LiveBettingDashboard />
      </main>
    </div>
  );
}
