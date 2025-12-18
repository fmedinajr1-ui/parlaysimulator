import { AppShell } from '@/components/layout/AppShell';
import { MedianLockDashboard } from '@/components/medianlock/MedianLockDashboard';

export default function MedianLock() {
  return (
    <AppShell>
      <div className="container max-w-7xl mx-auto px-4 py-6 pb-24">
        <MedianLockDashboard />
      </div>
    </AppShell>
  );
}
