import { LiveBettingDashboard } from '@/components/live/LiveBettingDashboard';
import { Radio } from 'lucide-react';

export default function LiveDashboard() {
  return (
    <div className="min-h-screen bg-background pb-24">
      <header className="sticky top-0 z-40 bg-background/95 backdrop-blur border-b border-border/50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="relative">
              <Radio className="w-6 h-6 text-primary" />
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            </div>
            <div>
              <h1 className="text-xl font-display font-bold">Live Dashboard</h1>
              <p className="text-xs text-muted-foreground">Track your pending parlays in real-time</p>
            </div>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-6">
        <LiveBettingDashboard />
      </main>
    </div>
  );
}
