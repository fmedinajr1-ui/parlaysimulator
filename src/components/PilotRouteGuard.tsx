import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { usePilotUser } from '@/hooks/usePilotUser';
import { FullPageWolfLoader } from '@/components/ui/wolf-loader';

// Routes that pilot users can access
const PILOT_ALLOWED_ROUTES = [
  '/',
  '/upload',
  '/results',
  '/profile',
  '/auth',
  '/kelly',
  '/compare',
  '/verify-phone',
  '/install',
  '/offline',
];

interface PilotRouteGuardProps {
  children: ReactNode;
}

export function PilotRouteGuard({ children }: PilotRouteGuardProps) {
  const { isLoading, isPilotUser, isAdmin, isSubscribed } = usePilotUser();
  const location = useLocation();

  // Still loading - show wolf loader
  if (isLoading) {
    return <FullPageWolfLoader />;
  }

  // Admins and subscribers have full access
  if (isAdmin || isSubscribed) {
    return <>{children}</>;
  }

  // Non-pilot users have full access (legacy free tier)
  if (!isPilotUser) {
    return <>{children}</>;
  }

  // Pilot users - check if route is allowed
  const isAllowedRoute = PILOT_ALLOWED_ROUTES.some(route => 
    location.pathname === route || location.pathname.startsWith(route + '/')
  );

  if (!isAllowedRoute) {
    // Redirect to profile with message
    return <Navigate to="/profile?restricted=true" replace />;
  }

  return <>{children}</>;
}

// Export the allowed routes for use in navigation components
export { PILOT_ALLOWED_ROUTES };
