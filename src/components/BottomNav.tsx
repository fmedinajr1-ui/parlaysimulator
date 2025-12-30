import { Home, BarChart3, User, GitCompare, WifiOff, Users, Radio } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePWA } from "@/hooks/usePWA";
import { MenuDrawer } from "@/components/layout/MenuDrawer";
import { usePilotUser } from "@/hooks/usePilotUser";
import { PILOT_ALLOWED_ROUTES } from "@/components/PilotRouteGuard";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { useViewport } from "@/hooks/useViewport";
import { ScanBalanceBadge } from "@/components/ui/scan-balance-badge";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

const allNavItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Analyze", path: "/upload" },
  { icon: Radio, label: "Live", path: "/live-dashboard" },
  { icon: Users, label: "Pools", path: "/pools" },
  { icon: User, label: "Profile", path: "/profile" },
];

// Routes where bottom nav should always be visible (no hide on scroll)
const ALWAYS_VISIBLE_ROUTES = ['/auth', '/verify-email', '/login', '/signup'];

export function BottomNav() {
  const location = useLocation();
  const { isOnline } = usePWA();
  const { isPilotUser, isAdmin, isSubscribed, totalScansAvailable } = usePilotUser();
  const { isVisible } = useScrollDirection(15);
  const { isSmallPhone } = useViewport();
  const haptics = useHapticFeedback();
  
  // Always show nav on auth-related pages
  const shouldAlwaysShow = ALWAYS_VISIBLE_ROUTES.some(route => location.pathname.startsWith(route));
  const navVisible = shouldAlwaysShow || isVisible;

  // Filter nav items for pilot users
  const navItems = (isPilotUser && !isAdmin && !isSubscribed)
    ? allNavItems.filter(item => PILOT_ALLOWED_ROUTES.includes(item.path))
    : allNavItems;

  // Show scan indicator for non-admin, non-subscribed users
  const showScanIndicator = !isAdmin && !isSubscribed;

  return (
    <nav className={cn(
      "fixed bottom-0 left-0 right-0 z-50 pb-safe",
      "bg-background/90 backdrop-blur-3xl",
      "border-t border-white/[0.12]",
      "shadow-[0_-4px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.12),inset_0_2px_4px_rgba(255,255,255,0.04)]",
      "transition-all duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]",
      !navVisible && "translate-y-full opacity-0"
    )}>
      {/* Gradient overlay for premium glass effect */}
      <div className="absolute inset-0 bg-gradient-to-b from-white/[0.06] via-transparent to-black/[0.04] pointer-events-none" />
      
      <div className="relative">
        {/* Offline indicator */}
        {!isOnline && (
          <div className="flex items-center justify-center gap-2 py-1 bg-neon-orange/10 text-neon-orange text-xs font-medium border-b border-neon-orange/20">
            <WifiOff className="w-3 h-3" />
            <span>Offline</span>
          </div>
        )}
        
        <div className={cn(
        "flex items-center justify-evenly px-1 max-w-lg mx-auto py-2",
        isSmallPhone ? "h-[64px]" : "h-[76px]"
      )}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;
          const isAnalyzeTab = item.path === '/upload';

          const handleClick = (e: React.MouseEvent) => {
            if (isActive) {
              e.preventDefault();
              haptics.lightTap(); // Light feedback for scroll-to-top
              window.scrollTo({ top: 0, behavior: 'smooth' });
            } else {
              haptics.tabSwitch(); // iOS-style tab switch haptic
            }
          };

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleClick}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5",
                "flex-1 h-full",
                isSmallPhone ? "max-w-[56px]" : "max-w-[80px]",
                "transition-all duration-200 active:scale-95",
                "touch-manipulation select-none",
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground active:text-foreground"
              )}
            >
              {/* Active indicator - pill highlight */}
              {isActive && (
                <div className="absolute top-1 left-1/2 -translate-x-1/2 w-10 h-[3px] rounded-full bg-primary" />
              )}
              
              <div className={cn(
                "relative flex items-center justify-center rounded-2xl transition-all duration-300",
                isSmallPhone ? "w-12 h-9" : "w-14 h-10",
                isActive && "bg-primary/15 scale-105"
              )}>
                <Icon 
                  className={cn(
                    "w-6 h-6 transition-all duration-300",
                    isActive && "text-primary"
                  )} 
                />
                
                {/* Scan count badge on Analyze tab */}
                {isAnalyzeTab && showScanIndicator && (
                  <div className="absolute -top-1 -right-1">
                    <ScanBalanceBadge 
                      scansRemaining={totalScansAvailable} 
                      size="sm"
                      showIcon={false}
                    />
                  </div>
                )}
              </div>
              
              {/* Hide labels on small phones */}
              {!isSmallPhone && (
                <span className={cn(
                  "text-[11px] transition-colors",
                  isActive ? "text-primary font-bold" : "text-muted-foreground font-medium"
                )}>
                  {item.label}
                </span>
              )}
            </Link>
          );
        })}
        
        {/* Hamburger Menu */}
        <MenuDrawer />
        </div>
      </div>
    </nav>
  );
}
