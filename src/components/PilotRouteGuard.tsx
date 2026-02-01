import { ReactNode } from 'react';

/**
 * PilotRouteGuard - Previously restricted routes for pilot users.
 * Now simplified to allow ALL users full access to ALL routes.
 * Kept as a passthrough for future feature gating if needed.
 */
interface PilotRouteGuardProps {
  children: ReactNode;
}

export function PilotRouteGuard({ children }: PilotRouteGuardProps) {
  // All users now have full access to all routes
  return <>{children}</>;
}

// Legacy export - no longer used for restrictions
export const PILOT_ALLOWED_ROUTES: string[] = [];
