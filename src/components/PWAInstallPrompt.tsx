import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { X, Download, Share, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion, AnimatePresence } from 'framer-motion';
import wolfLoaderImage from "@/assets/wolf-loader.png";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const EXCLUDED_PATHS = ['/auth', '/install', '/verify-email', '/offline'];

export function PWAInstallPrompt() {
  const navigate = useNavigate();
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const [isIOS, setIsIOS] = useState(false);

  useEffect(() => {
    // Don't show if already installed
    const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                        (window.navigator as any).standalone === true;
    if (isStandalone) return;

    // Check if dismissed recently
    const dismissed = localStorage.getItem('pwa-prompt-dismissed');
    if (dismissed) {
      const dismissedDate = new Date(dismissed);
      const daysSinceDismissed = (Date.now() - dismissedDate.getTime()) / (1000 * 60 * 60 * 24);
      if (daysSinceDismissed < 7) return; // Don't show for 7 days after dismissal
    }

    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Show iOS prompt after delay
    if (iOS) {
      const timer = setTimeout(() => setShowPrompt(true), 5000);
      return () => clearTimeout(timer);
    }

    // Listen for beforeinstallprompt
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setTimeout(() => setShowPrompt(true), 3000); // Show after 3 seconds
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setShowPrompt(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    setShowPrompt(false);
    localStorage.setItem('pwa-prompt-dismissed', new Date().toISOString());
  };

  const handleLearnMore = () => {
    setShowPrompt(false);
    navigate('/install');
  };

  // Don't show on excluded paths
  if (EXCLUDED_PATHS.some(path => location.pathname.startsWith(path))) {
    return null;
  }

  return (
    <AnimatePresence>
      {showPrompt && (
        <motion.div
          initial={{ y: "100%", opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: "100%", opacity: 0 }}
          transition={{ type: "spring", damping: 25, stiffness: 300 }}
          className={cn(
            "fixed bottom-20 left-3 right-3 z-50 safe-area-inset-bottom",
            "sm:left-auto sm:right-4 sm:bottom-24 sm:max-w-sm"
          )}
        >
          <div className={cn(
            "bg-card/98 backdrop-blur-xl rounded-2xl border border-border/50",
            "shadow-[0_-8px_40px_rgba(0,0,0,0.4)]",
            "p-4 relative overflow-hidden"
          )}>
            {/* Gradient accent */}
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary via-accent to-primary" />
            
            <button 
              onClick={handleDismiss}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            
            <div className="flex items-start gap-3 pr-8">
              {/* Wolf Icon */}
              <div className="w-14 h-14 rounded-xl bg-gradient-to-br from-primary/20 to-accent/20 flex items-center justify-center shrink-0 border border-primary/20">
                <img 
                  src={wolfLoaderImage} 
                  alt="Parlay Farm" 
                  className="w-10 h-10 object-contain"
                />
              </div>
              
              <div className="flex-1 min-w-0">
                <h3 className="font-display font-bold text-foreground text-base mb-0.5">
                  Install Parlay Farm
                </h3>
                <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                  {isIOS 
                    ? "Add to your home screen for the best experience"
                    : "Get instant access and push notifications"
                  }
                </p>
                
                {deferredPrompt ? (
                  <Button 
                    onClick={handleInstall} 
                    size="sm" 
                    className="w-full gradient-fire h-9"
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Install App
                  </Button>
                ) : isIOS ? (
                  <div className="space-y-2">
                    {/* iOS Instructions */}
                    <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-lg p-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-[10px]">1</span>
                        <span>Tap</span>
                        <Share className="w-4 h-4 text-primary" />
                      </div>
                      <span>→</span>
                      <div className="flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center text-primary font-bold text-[10px]">2</span>
                        <Plus className="w-4 h-4 text-primary" />
                        <span>Add to Home</span>
                      </div>
                    </div>
                    <Button 
                      onClick={handleLearnMore} 
                      size="sm" 
                      variant="outline"
                      className="w-full h-9"
                    >
                      See Full Guide
                    </Button>
                  </div>
                ) : null}
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
