import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParlayBuilderProvider } from "@/contexts/ParlayBuilderContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { BottomNav } from "@/components/BottomNav";
import { UniversalParlayBuilder } from "@/components/parlay/UniversalParlayBuilder";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { AnimatePresence, motion } from "framer-motion";
import { PilotRouteGuard } from "@/components/PilotRouteGuard";
import { PhoneVerificationGuard } from "@/components/PhoneVerificationGuard";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";

// Lazy load all pages for code splitting
const Index = React.lazy(() => import("./pages/Index"));
const Upload = React.lazy(() => import("./pages/Upload"));
const Results = React.lazy(() => import("./pages/Results"));
const Profile = React.lazy(() => import("./pages/Profile"));
const Auth = React.lazy(() => import("./pages/Auth"));
const Admin = React.lazy(() => import("./pages/Admin"));
const Collaborate = React.lazy(() => import("./pages/Collaborate"));
const Compare = React.lazy(() => import("./pages/Compare"));
const Suggestions = React.lazy(() => import("./pages/Suggestions"));
const OddsMovement = React.lazy(() => import("./pages/OddsMovement"));
const SharpMoney = React.lazy(() => import("./pages/SharpMoney"));
const LineShopping = React.lazy(() => import("./pages/LineShopping"));
const SportsFatigue = React.lazy(() => import("./pages/SportsFatigue"));
const Install = React.lazy(() => import("./pages/Install"));
const Offline = React.lazy(() => import("./pages/Offline"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const PVSCalculator = React.lazy(() => import("./pages/PVSCalculator"));
const GodModeUpsets = React.lazy(() => import("./pages/GodModeUpsets"));
const GodModeDashboard = React.lazy(() => import("./pages/GodModeDashboard"));
const HitRate = React.lazy(() => import("./pages/HitRate"));
const BestBets = React.lazy(() => import("./pages/BestBets"));
const SharpComparison = React.lazy(() => import("./pages/SharpComparison"));
const FanDuelTraps = React.lazy(() => import("./pages/FanDuelTraps"));
const AllSportsTracker = React.lazy(() => import("./pages/AllSportsTracker"));
const Kelly = React.lazy(() => import("./pages/Kelly"));
const MedianLock = React.lazy(() => import("./pages/MedianLock"));
const VerifyPhone = React.lazy(() => import("./pages/VerifyPhone"));
const Pools = React.lazy(() => import("./pages/Pools"));
const PoolDetail = React.lazy(() => import("./pages/PoolDetail"));
const JoinPool = React.lazy(() => import("./pages/JoinPool"));


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
              <Route path="/" element={<Index />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/results" element={<Results />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/collaborate" element={<Collaborate />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/suggestions" element={<Suggestions />} />
              <Route path="/odds" element={<OddsMovement />} />
              <Route path="/sharp" element={<SharpMoney />} />
              <Route path="/line-shopping" element={<LineShopping />} />
              <Route path="/sports-fatigue" element={<SportsFatigue />} />
              <Route path="/nba-fatigue" element={<SportsFatigue />} />
              <Route path="/install" element={<Install />} />
              <Route path="/offline" element={<Offline />} />
              <Route path="/pvs-calculator" element={<PVSCalculator />} />
              <Route path="/god-mode" element={<GodModeUpsets />} />
              <Route path="/god-mode-tracker" element={<GodModeDashboard />} />
              <Route path="/hitrate" element={<HitRate />} />
              <Route path="/best-bets" element={<BestBets />} />
              <Route path="/sharp-comparison" element={<SharpComparison />} />
              <Route path="/fanduel-traps" element={<FanDuelTraps />} />
              <Route path="/tracker" element={<AllSportsTracker />} />
              <Route path="/kelly" element={<Kelly />} />
              <Route path="/median-lock" element={<MedianLock />} />
              <Route path="/verify-phone" element={<VerifyPhone />} />
              <Route path="/verify-email" element={<Navigate to="/auth" replace />} />
              <Route path="/pools" element={<Pools />} />
              <Route path="/pools/:id" element={<PoolDetail />} />
              <Route path="/pools/join/:inviteCode" element={<JoinPool />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </React.Suspense>
        </RouteErrorBoundary>
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  const [isMobile, setIsMobile] = React.useState(false);
  
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener("resize", checkMobile);
    return () => window.removeEventListener("resize", checkMobile);
  }, []);
  
  return (
    <PhoneVerificationGuard>
      <PilotRouteGuard>
        <Toaster />
        <Sonner />
        <PWAUpdatePrompt />
        <AnimatedRoutes />
        <UniversalParlayBuilder />
        {isMobile && <BottomNav />}
        <PWAInstallPrompt />
      </PilotRouteGuard>
    </PhoneVerificationGuard>
  );
}

const App = () => {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ParlayBuilderProvider>
            <TooltipProvider>
              <AppContent />
            </TooltipProvider>
          </ParlayBuilderProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
