import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { PWAInstallPrompt } from "@/components/PWAInstallPrompt";
import Index from "./pages/Index";
import Upload from "./pages/Upload";
import Results from "./pages/Results";
import Profile from "./pages/Profile";
import Auth from "./pages/Auth";
import Admin from "./pages/Admin";
import Compare from "./pages/Compare";
import Suggestions from "./pages/Suggestions";
import OddsMovement from "./pages/OddsMovement";
import SharpMoney from "./pages/SharpMoney";
import LineShopping from "./pages/LineShopping";
import Install from "./pages/Install";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => { 
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/upload" element={<Upload />} />
              <Route path="/results" element={<Results />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/auth" element={<Auth />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/suggestions" element={<Suggestions />} />
              <Route path="/odds" element={<OddsMovement />} />
              <Route path="/sharp" element={<SharpMoney />} />
              <Route path="/line-shopping" element={<LineShopping />} />
              <Route path="/install" element={<Install />} />
              {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
              <Route path="*" element={<NotFound />} />
            </Routes>
            <PWAInstallPrompt />
          </BrowserRouter>
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
};

export default App;
