import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { ParlayBuilderProvider } from "@/contexts/ParlayBuilderContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import { PageTransition } from "@/components/PageTransition";
import { BottomNav } from "@/components/BottomNav";
import { UniversalParlayBuilder } from "@/components/parlay/UniversalParlayBuilder";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import Results from "./pages/Results";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Collaborate from "./pages/Collaborate";
import Compare from "./pages/Compare";
import Suggestions from "./pages/Suggestions";
import OddsMovement from "./pages/OddsMovement";
import SharpMoney from "./pages/SharpMoney";
import LineShopping from "./pages/LineShopping";
import NBAFatigue from "./pages/NBAFatigue";
import Install from "./pages/Install";
import NotFound from "./pages/NotFound";
import PVSCalculator from "./pages/PVSCalculator";
import GodModeUpsets from "./pages/GodModeUpsets";
import GodModeDashboard from "./pages/GodModeDashboard";
import HitRate from "./pages/HitRate";

const queryClient = new QueryClient();

function AnimatedRoutes() {
  const location = useLocation();
  
  return (
    <PageTransition key={location.pathname}>
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
    </PageTransition>
  );
}

const App = () => { 
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ParlayBuilderProvider>
            <TooltipProvider>
              <Toaster />
              <Sonner />
              <AnimatedRoutes />
              <UniversalParlayBuilder />
              <BottomNav />
              <PWAInstallPrompt />
            </TooltipProvider>
          </ParlayBuilderProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
