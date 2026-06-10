// @ts-nocheck
import React from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, Navigate } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParlayBuilderProvider } from "@/contexts/ParlayBuilderContext";
import { PilotUserProvider } from "@/contexts/PilotUserContext";

import { MobileFloatingMenu } from "@/components/layout/MobileFloatingMenu";
import { UniversalParlayBuilder } from "@/components/parlay/UniversalParlayBuilder";
import { WolfLoadingOverlay } from "@/components/ui/wolf-loading-overlay";
import { AnimatePresence, motion } from "framer-motion";
import { PilotRouteGuard } from "@/components/PilotRouteGuard";
import { EmailVerificationGuard } from "@/components/EmailVerificationGuard";
import { PWAUpdatePrompt } from "@/components/PWAUpdatePrompt";
import { RouteErrorBoundary } from "@/components/RouteErrorBoundary";
import { useRoutePersistence } from "@/hooks/useRoutePersistence";
import { usePageLifecycle } from "@/hooks/usePageLifecycle";
import { usePageView } from "@/hooks/useAnalytics";

// Lazy load pages
const BotDashboard = React.lazy(() => import("./pages/BotDashboard"));
const BotLanding = React.lazy(() => import("./pages/BotLanding"));
const Home = React.lazy(() => import("./pages/Home"));
const SweetSpots = React.lazy(() => import("./pages/SweetSpots"));
const VerifyEmail = React.lazy(() => import("./pages/VerifyEmail"));
const Admin = React.lazy(() => import("./pages/Admin"));
const Collaborate = React.lazy(() => import("./pages/Collaborate"));
const ReleaseManager = React.lazy(() => import("./pages/admin/ReleaseManager"));
const Offline = React.lazy(() => import("./pages/Offline"));
const TeamBets = React.lazy(() => import("./pages/TeamBets"));
const AdminLogin = React.lazy(() => import("./pages/AdminLogin"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const ProfitPlan = React.lazy(() => import("./pages/ProfitPlan"));
const Scout = React.lazy(() => import("./pages/Scout"));
const BotSuccess = React.lazy(() => import("./pages/BotSuccess"));
const BotPipeline = React.lazy(() => import("./pages/BotPipeline"));
const BotLegDiagnostics = React.lazy(() => import("./pages/BotLegDiagnostics"));
const BlogIndex = React.lazy(() => import("./pages/BlogIndex"));
const BlogPost = React.lazy(() => import("./pages/BlogPost"));
const BlogCategory = React.lazy(() => import("./pages/BlogCategory"));
const AdminBlog = React.lazy(() => import("./pages/admin/AdminBlog"));
const Unsubscribe = React.lazy(() => import("./pages/Unsubscribe"));
const GradeSlip = React.lazy(() => import("./pages/GradeSlip"));
const AdminTikTok = React.lazy(() => import("./pages/admin/AdminTikTok"));
const AdminAlertThresholds = React.lazy(() => import("./pages/admin/AlertThresholds"));
const ScoutSpeedEdge = React.lazy(() => import("./pages/admin/ScoutSpeedEdge"));
const PropAlertVerifier = React.lazy(() => import("./pages/admin/PropAlertVerifier"));
const CourtEdgeAccuracy = React.lazy(() => import("./pages/admin/CourtEdgeAccuracy"));
const CrawlerRunsPage = React.lazy(() => import("./pages/admin/CrawlerRunsPage"));
const MlbFairPriceDashboard = React.lazy(() => import("./pages/admin/MlbFairPriceDashboard"));
const PropScanner = React.lazy(() => import("./pages/PropScanner"));
const ManualBuilder = React.lazy(() => import("./pages/ManualBuilder"));
const LiveAI = React.lazy(() => import("./pages/LiveAI"));
const LiveGames = React.lazy(() => import("./pages/LiveGames"));
const LiveGame = React.lazy(() => import("./pages/LiveGame"));

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
              <Route path="/" element={<Home />} />
              <Route path="/legacy-landing" element={<BotLanding />} />
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
              <Route path="/admin-login" element={<AdminLogin />} />
              <Route path="/profit-plan" element={<ProfitPlan />} />
              <Route path="/scout" element={<Scout />} />
              <Route path="/bot-success" element={<BotSuccess />} />
              <Route path="/bot-pipeline" element={<BotPipeline />} />
              <Route path="/admin/bot-leg-diagnostics" element={<BotLegDiagnostics />} />
              <Route path="/blog" element={<BlogIndex />} />
              <Route path="/blog/category/:cat" element={<BlogCategory />} />
              <Route path="/blog/:slug" element={<BlogPost />} />
              <Route path="/admin/blog" element={<AdminBlog />} />
              <Route path="/admin/tiktok" element={<AdminTikTok />} />
              <Route path="/admin/alert-thresholds" element={<AdminAlertThresholds />} />
              <Route path="/admin/scout-speed" element={<ScoutSpeedEdge />} />
              <Route path="/admin/verifier" element={<PropAlertVerifier />} />
              <Route path="/admin/court-edge-accuracy" element={<CourtEdgeAccuracy />} />
              <Route path="/admin/crawlers" element={<CrawlerRunsPage />} />
              <Route path="/admin/mlb-fair-price" element={<MlbFairPriceDashboard />} />
              <Route path="/unsubscribe" element={<Unsubscribe />} />
              <Route path="/grade" element={<GradeSlip />} />
              <Route path="/scan" element={<PropScanner />} />
              <Route path="/manual" element={<ManualBuilder />} />
              <Route path="/live-ai" element={<LiveAI />} />
              <Route path="/spike/:token" element={<LiveAI />} />
              <Route path="/live" element={<LiveGames />} />
              <Route path="/live/:gameId" element={<LiveGame />} />
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
    usePageView();
  } catch (error) {
    console.warn('[SafeRoutePersistence] Hook failed, likely stale cache:', error);
  }
  return null;
}

function AppContent() {
  const [isMobile, setIsMobile] = React.useState(false);
  const [isReady, setIsReady] = React.useState(false);
  const location = useLocation();
  
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
        {isMobile && location.pathname !== '/' && location.pathname !== '/live-ai' && !location.pathname.startsWith('/spike/') && <MobileFloatingMenu />}
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
