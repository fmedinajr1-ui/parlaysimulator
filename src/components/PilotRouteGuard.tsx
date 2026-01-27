import { ReactNode, useState, useEffect } from 'react';
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
  '/verify-email',
  '/install',
  '/offline',
  '/daily-elite',
  '/pools',
  '/pools/join',
  '/draft',
  '/tomorrow-3pt',
];

interface PilotRouteGuardProps {
  children: ReactNode;
}

export function PilotRouteGuard({ children }: PilotRouteGuardProps) {
  const location = useLocation();
  const [hasError, setHasError] = useState(false);
  
  // Wrap usePilotUser in try-catch via state to handle hook errors gracefully
  let pilotData = { isLoading: false, isPilotUser: false, isAdmin: false, isSubscribed: false };
  
  try {
    pilotData = usePilotUser();
  } catch (error) {
    console.error('PilotRouteGuard: Hook error, allowing access:', error);
    // On error, allow access rather than blocking
    if (!hasError) setHasError(true);
    return <>{children}</>;
  }
  
  const { isLoading, isPilotUser, isAdmin, isSubscribed } = pilotData;

  // Still loading - show wolf loader (with timeout fallback)
  if (isLoading && !hasError) {
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
