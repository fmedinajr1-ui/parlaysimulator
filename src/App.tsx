import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParlayBuilderProvider } from "@/contexts/ParlayBuilderContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { BottomNav } from "@/components/BottomNav";
import { UniversalParlayBuilder } from "@/components/parlay/UniversalParlayBuilder";
import { PageSkeleton } from "@/components/ui/page-skeleton";
import { AnimatePresence, motion } from "framer-motion";
import { useIsMobile } from "@/hooks/use-mobile";

// Lazy load all pages for code splitting
const Index = lazy(() => import("./pages/Index"));
const Upload = lazy(() => import("./pages/Upload"));
const Results = lazy(() => import("./pages/Results"));
const Profile = lazy(() => import("./pages/Profile"));
const Auth = lazy(() => import("./pages/Auth"));
const Admin = lazy(() => import("./pages/Admin"));
const Collaborate = lazy(() => import("./pages/Collaborate"));
const Compare = lazy(() => import("./pages/Compare"));
const Suggestions = lazy(() => import("./pages/Suggestions"));
const OddsMovement = lazy(() => import("./pages/OddsMovement"));
const SharpMoney = lazy(() => import("./pages/SharpMoney"));
const LineShopping = lazy(() => import("./pages/LineShopping"));
const NBAFatigue = lazy(() => import("./pages/NBAFatigue"));
const Install = lazy(() => import("./pages/Install"));
const NotFound = lazy(() => import("./pages/NotFound"));
const PVSCalculator = lazy(() => import("./pages/PVSCalculator"));
const GodModeUpsets = lazy(() => import("./pages/GodModeUpsets"));
const GodModeDashboard = lazy(() => import("./pages/GodModeDashboard"));
const HitRate = lazy(() => import("./pages/HitRate"));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 30, // 30 minutes
    },
  },
});

const pageVariants = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
};

const pageTransition = {
  type: "tween" as const,
  ease: [0.25, 0.1, 0.25, 1] as const,
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
      >
        <Suspense fallback={<PageSkeleton variant="dashboard" />}>
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
            <Route path="/nba-fatigue" element={<NBAFatigue />} />
            <Route path="/install" element={<Install />} />
            <Route path="/pvs-calculator" element={<PVSCalculator />} />
            <Route path="/god-mode" element={<GodModeUpsets />} />
            <Route path="/god-mode-tracker" element={<GodModeDashboard />} />
            <Route path="/hitrate" element={<HitRate />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </motion.div>
    </AnimatePresence>
  );
}

function AppContent() {
  const isMobile = useIsMobile();
  
  return (
    <>
      <Toaster />
      <Sonner />
      <AnimatedRoutes />
      <UniversalParlayBuilder />
      {isMobile && <BottomNav />}
      <PWAInstallPrompt />
    </>
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
