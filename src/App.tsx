import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParlayBuilderProvider } from "@/contexts/ParlayBuilderContext";
import { PilotUserProvider } from "@/contexts/PilotUserContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { BottomNav } from "@/components/BottomNav";
import { UniversalParlayBuilder } from "@/components/parlay/UniversalParlayBuilder";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { AnimatePresence, motion } from "framer-motion";
import { PilotRouteGuard } from "@/components/PilotRouteGuard";
import { EmailVerificationGuard } from "@/components/EmailVerificationGuard";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useRoutePersistence } from "@/hooks/useRoutePersistence";
import { usePageLifecycle } from "@/hooks/usePageLifecycle";

// Lazy load pages
const BotDashboard = React.lazy(() => import("./pages/BotDashboard"));
const BotLanding = React.lazy(() => import("./pages/BotLanding"));
const SweetSpots = React.lazy(() => import("./pages/SweetSpots"));
const VerifyEmail = React.lazy(() => import("./pages/VerifyEmail"));
const Admin = React.lazy(() => import("./pages/Admin"));
const Collaborate = React.lazy(() => import("./pages/Collaborate"));
const ReleaseManager = React.lazy(() => import("./pages/admin/ReleaseManager"));
const Offline = React.lazy(() => import("./pages/Offline"));
const TeamBets = React.lazy(() => import("./pages/TeamBets"));
const NotFound = React.lazy(() => import("./pages/NotFound"));

// QueryClient with optimized defaults
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      gcTime: 1000 * 60 * 30,
    },
  },
});

const pageVariants = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
};

const pageTransition = {
  duration: 0.15,
};

function AnimatedRoutes() {
  const location = useLocation();
  
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={location.pathname}
        initial="initial"
        animate="animate"
        exit="exit"
        variants={pageVariants}
        transition={pageTransition}
        style={{ pointerEvents: 'auto' }}
      >
        <RouteErrorBoundary>
          <React.Suspense fallback={<WolfLoadingOverlay />}>
            <Routes location={location}>
              <Route path="/" element={<BotLanding />} />
              <Route path="/sweet-spots" element={<SweetSpots />} />
              <Route path="/auth" element={<Navigate to="/" replace />} />
              <Route path="/bot" element={<Navigate to="/" replace />} />
              <Route path="/dashboard" element={<BotDashboard />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/admin/releases" element={<ReleaseManager />} />
              <Route path="/collaborate" element={<Collaborate />} />
              <Route path="/team-bets" element={<TeamBets />} />
              <Route path="/offline" element={<Offline />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </React.Suspense>
        </RouteErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

// Safe wrapper that catches hook errors from stale PWA cache
function SafeRoutePersistence() {
  try {
    useRoutePersistence();
    usePageLifecycle();
  } catch (error) {
    console.warn('[SafeRoutePersistence] Hook failed, likely stale cache:', error);
  }
  return null;
}

function AppContent() {
  const [isMobile, setIsMobile] = React.useState(false);
  const [isReady, setIsReady] = React.useState(false);
  
  React.useEffect(() => {
    // Small delay to ensure React is fully hydrated (prevents stale chunk issues)
    const timer = setTimeout(() => setIsReady(true), 50);
    return () => clearTimeout(timer);
  }, []);
  
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  // Show loading overlay until React is fully ready
  if (!isReady) {
    return <WolfLoadingOverlay />;
  }
  
  return (
    <EmailVerificationGuard>
      <PilotRouteGuard>
        <SafeRoutePersistence />
        <Toaster />
        <Sonner />
        <PWAUpdatePrompt />
        <AnimatedRoutes />
        <UniversalParlayBuilder />
        {isMobile && <BottomNav />}
        <PWAInstallPrompt />
      </PilotRouteGuard>
    </EmailVerificationGuard>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <PilotUserProvider>
            <ParlayBuilderProvider>
              <TooltipProvider>
                <AppContent />
              </TooltipProvider>
            </ParlayBuilderProvider>
          </PilotUserProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
