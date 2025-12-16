import { Home, BarChart3, User, Wallet, WifiOff } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { usePWA } from "@/hooks/usePWA";
import { MenuDrawer } from "@/components/layout/MenuDrawer";
import { usePilotUser } from "@/hooks/usePilotUser";
import { PILOT_ALLOWED_ROUTES } from "@/components/PilotRouteGuard";
import { useScrollDirection } from "@/hooks/useScrollDirection";
import { useViewport } from "@/hooks/useViewport";

const allNavItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Analyze", path: "/upload" },
  { icon: Wallet, label: "Kelly", path: "/kelly" },
  { icon: User, label: "Profile", path: "/profile" },
];

export function BottomNav() {
  const location = useLocation();
  const { isOnline } = usePWA();
  const { isPilotUser, isAdmin, isSubscribed } = usePilotUser();
  const { isVisible } = useScrollDirection(15);
  const { isSmallPhone } = useViewport();

  // Filter nav items for pilot users
  const navItems = (isPilotUser && !isAdmin && !isSubscribed)
    ? allNavItems.filter(item => PILOT_ALLOWED_ROUTES.includes(item.path))
    : allNavItems;

  return (
    <nav className={cn(
      "fixed bottom-0 left-0 right-0 z-50",
      "bg-background/98 backdrop-blur-xl sm:backdrop-blur-2xl",
      "border-t border-border/30",
      "shadow-[0_-4px_20px_rgba(0,0,0,0.3)]",
      "transition-transform duration-300 ease-out",
      !isVisible && "translate-y-full"
    )}>
      {/* Offline indicator */}
      {!isOnline && (
        <div className="flex items-center justify-center gap-2 py-1 bg-neon-orange/10 text-neon-orange text-xs font-medium border-b border-neon-orange/20">
          <WifiOff className="w-3 h-3" />
          <span>Offline</span>
        </div>
      )}
      
      <div className={cn(
        "flex items-center justify-around px-2 max-w-lg mx-auto pb-safe",
        isSmallPhone ? "h-[64px]" : "h-[72px]"
      )}>
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          const handleClick = (e: React.MouseEvent) => {
            if (isActive) {
              e.preventDefault();
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          };

          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={handleClick}
              className={cn(
                "relative flex flex-col items-center justify-center gap-0.5",
                "flex-1 h-full max-w-[80px]",
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
                isSmallPhone ? "w-10 h-7" : "w-12 h-8",
                isActive && "bg-primary/15"
              )}>
                <Icon 
                  className={cn(
                    "transition-all duration-300", 
                    isSmallPhone ? "w-5 h-5" : "w-[22px] h-[22px]",
                    isActive && "text-primary"
                  )} 
                />
              </div>
              
              {/* Hide labels on small phones */}
              {!isSmallPhone && (
                <span className={cn(
                  "text-[11px] font-semibold transition-colors",
                  isActive ? "text-primary" : "text-muted-foreground"
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
    </nav>
  );
}
