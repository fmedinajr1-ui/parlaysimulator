import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { X, Download, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const EXCLUDED_PATHS = ['/auth', '/install', '/verify-phone', '/offline'];

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

  if (!showPrompt) return null;

  return (
    <div className={cn(
      "fixed bottom-24 left-4 right-4 z-50 animate-fade-in",
      "bg-card/95 backdrop-blur-xl rounded-2xl border border-border shadow-2xl",
      "p-4 max-w-md mx-auto"
    )}>
      <button 
        onClick={handleDismiss}
        className="absolute top-2 right-2 p-1 text-muted-foreground hover:text-foreground transition-colors"
      >
        <X className="w-4 h-4" />
      </button>
      
      <div className="flex items-start gap-3">
        <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
          <Smartphone className="w-6 h-6 text-primary" />
        </div>
        
        <div className="flex-1 min-w-0">
          <h3 className="font-semibold text-foreground text-sm mb-1">
            Install Parlay Farm
          </h3>
          <p className="text-xs text-muted-foreground mb-3">
            {isIOS 
              ? "Tap Share then 'Add to Home Screen' for the best experience"
              : "Install our app for instant access and push notifications"
            }
          </p>
          
          {deferredPrompt ? (
            <Button 
              onClick={handleInstall} 
              size="sm" 
              className="w-full gradient-fire"
            >
              <Download className="w-4 h-4 mr-2" />
              Install Now
            </Button>
          ) : isIOS ? (
            <Button 
              onClick={handleLearnMore} 
              size="sm" 
              variant="outline"
              className="w-full"
            >
              Learn How to Install
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
