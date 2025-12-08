import React from 'react';
import { AppShell } from '@/components/layout/AppShell';
import { GodModeTrackerDashboard } from '@/components/godmode/GodModeTrackerDashboard';

const GodModeDashboard = () => {
  return (
    <AppShell>
      <GodModeTrackerDashboard />
    </AppShell>
  );
};

export default GodModeDashboard;
