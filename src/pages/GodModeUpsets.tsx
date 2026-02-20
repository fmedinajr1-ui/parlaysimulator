import { AppShell } from '@/components/layout/AppShell';
import { GodModeDashboard } from '@/components/upsets/GodModeDashboard';

export default function GodModeUpsets() {
  return (
    <AppShell>
      <div className="container max-w-7xl mx-auto px-4 py-6 pb-6">
        {/* Hero Header */}
        <div className="mb-8">
          <h1 className="text-3xl md:text-4xl font-bold bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 bg-clip-text text-transparent">
            CHESS vs Vegas: God Mode
          </h1>
          <p className="text-muted-foreground mt-2">
            AI-powered upset predictions using Sharp Money, CHESS EV, Monte Carlo, and Chaos Detection
          </p>
        </div>

        {/* Dashboard */}
        <GodModeDashboard />
      </div>
    </AppShell>
  );
}
