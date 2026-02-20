import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { 
  Download, 
  Smartphone, 
  Zap, 
  Bell, 
  Wifi, 
  Share,
  Plus,
  CheckCircle,
  Chrome,
  Apple
} from "lucide-react";
import { cn } from "@/lib/utils";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const Install = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstalled, setIsInstalled] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    // Check if running in standalone mode (already installed)
    const standalone = window.matchMedia('(display-mode: standalone)').matches || 
                       (window.navigator as any).standalone === true;
    setIsStandalone(standalone);
    
    // Check if iOS
    const iOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
    setIsIOS(iOS);

    // Listen for beforeinstallprompt event
    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    // Listen for app installed event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      setIsInstalled(true);
    }
    setDeferredPrompt(null);
  };

  const features = [
    { icon: Zap, title: "Lightning Fast", description: "Instant loading with offline support" },
    { icon: Bell, title: "Push Notifications", description: "Get alerts for sharp money moves" },
    { icon: Wifi, title: "Works Offline", description: "Access your data without internet" },
    { icon: Smartphone, title: "Native Feel", description: "Full-screen app experience" },
  ];

  if (isStandalone || isInstalled) {
    return (
      <div className="min-h-screen bg-background pb-6">
        <main className="max-w-lg mx-auto px-4 py-8">
          <div className="text-center py-12">
            <div className="w-20 h-20 rounded-full bg-neon-green/20 flex items-center justify-center mx-auto mb-6">
              <CheckCircle className="w-10 h-10 text-neon-green" />
            </div>
            <h1 className="text-2xl font-display text-foreground mb-2">APP INSTALLED!</h1>
            <p className="text-muted-foreground mb-6">
              You're running Parlay Farm as an installed app. Enjoy the full experience!
            </p>
            <Badge className="bg-neon-green/20 text-neon-green border-neon-green/30">
              <CheckCircle className="w-3 h-3 mr-1" />
              Installed
            </Badge>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-6">
      <MobileHeader 
        title="Install App" 
        subtitle="Get the native experience"
        showBack
        backTo="/"
        icon={<Download className="w-5 h-5" />}
      />
      <main className="max-w-lg mx-auto px-4 py-6">

        {/* Install Button */}
        {deferredPrompt ? (
          <Button 
            onClick={handleInstall} 
            className="w-full h-14 text-lg font-semibold mb-6 gradient-fire"
          >
            <Download className="w-5 h-5 mr-2" />
            Install Parlay Farm
          </Button>
        ) : isIOS ? (
          <Card className="bg-card/50 border-border/50 mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <Apple className="w-4 h-4 text-foreground" />
                iOS INSTALLATION
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap the Share button</p>
                    <p className="text-xs text-muted-foreground">At the bottom of Safari</p>
                    <Share className="w-5 h-5 text-muted-foreground mt-1" />
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap "Add to Home Screen"</p>
                    <p className="text-xs text-muted-foreground">Scroll down in the share menu</p>
                    <Plus className="w-5 h-5 text-muted-foreground mt-1" />
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">3</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap "Add"</p>
                    <p className="text-xs text-muted-foreground">Confirm the installation</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="bg-card/50 border-border/50 mb-6">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-display flex items-center gap-2">
                <Chrome className="w-4 h-4 text-foreground" />
                ANDROID / CHROME INSTALLATION
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">1</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap the menu (⋮)</p>
                    <p className="text-xs text-muted-foreground">Top right of Chrome</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">2</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap "Install app" or "Add to Home screen"</p>
                    <p className="text-xs text-muted-foreground">In the dropdown menu</p>
                  </div>
                </div>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                    <span className="text-sm font-bold text-primary">3</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">Tap "Install"</p>
                    <p className="text-xs text-muted-foreground">Confirm the installation</p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Features Grid */}
        <div className="grid grid-cols-2 gap-3 mb-6">
          {features.map((feature) => (
            <Card key={feature.title} className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <feature.icon className="w-6 h-6 text-primary mb-2" />
                <h3 className="text-sm font-semibold text-foreground mb-1">{feature.title}</h3>
                <p className="text-xs text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {/* Why Install */}
        <Card className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/20">
          <CardContent className="p-4">
            <h3 className="font-semibold text-foreground mb-2">Why install?</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-neon-green" />
                Access from home screen like a real app
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-neon-green" />
                Get push notifications for sharp money alerts
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-neon-green" />
                Works offline - view your history anytime
              </li>
              <li className="flex items-center gap-2">
                <CheckCircle className="w-3 h-3 text-neon-green" />
                No app store needed - instant install
              </li>
            </ul>
          </CardContent>
        </Card>
      </main>
    </div>
  );
};

export default Install;