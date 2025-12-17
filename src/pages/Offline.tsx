import { WifiOff, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";

const Offline = () => {
  const navigate = useNavigate();
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  useEffect(() => {
    // Auto-redirect when back online
    if (isOnline) {
      const timer = setTimeout(() => {
        navigate('/');
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isOnline, navigate]);

  const handleRetry = () => {
    setIsRefreshing(true);
    setTimeout(() => {
      if (navigator.onLine) {
        navigate('/');
      } else {
        setIsRefreshing(false);
      }
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-primary/20 to-primary/10 flex items-center justify-center mx-auto mb-4 shadow-lg">
            {isOnline ? (
              <RefreshCw className="w-10 h-10 text-neon-green animate-spin" />
            ) : (
              <WifiOff className="w-10 h-10 text-muted-foreground" />
            )}
          </div>
          <h1 className="text-2xl font-display text-foreground mb-2">
            {isOnline ? "BACK ONLINE!" : "YOU'RE OFFLINE"}
          </h1>
          <p className="text-muted-foreground">
            {isOnline 
              ? "Reconnecting to Parlay Farm..."
              : "Check your internet connection and try again"
            }
          </p>
        </div>

        {/* Status Card */}
        <Card className="bg-card/50 border-border/50 mb-6">
          <CardContent className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-center gap-2">
                <div className={`w-3 h-3 rounded-full ${isOnline ? 'bg-neon-green' : 'bg-destructive'} animate-pulse`} />
                <span className="text-sm text-muted-foreground">
                  {isOnline ? "Connected" : "No internet connection"}
                </span>
              </div>
              
              {!isOnline && (
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>While offline, you can still:</p>
                  <ul className="list-disc list-inside text-left ml-2 space-y-1">
                    <li>View previously loaded data</li>
                    <li>Access cached pages</li>
                    <li>Review your parlay history</li>
                  </ul>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="space-y-3">
          <Button 
            onClick={handleRetry}
            className="w-full gradient-fire"
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <>
                <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                Checking...
              </>
            ) : (
              <>
                <RefreshCw className="w-4 h-4 mr-2" />
                Try Again
              </>
            )}
          </Button>
          
          <Button 
            onClick={() => navigate('/')}
            variant="outline"
            className="w-full"
          >
            <Home className="w-4 h-4 mr-2" />
            Go Home
          </Button>
        </div>

        {/* Branding */}
        <p className="text-xs text-muted-foreground mt-8">
          Parlay Farm • Track Sharps, Tail Winners 🐕
        </p>
      </div>
    </div>
  );
};

export default Offline;
