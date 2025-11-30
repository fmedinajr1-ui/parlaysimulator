import { Home, BarChart3, User, Shield, Scale, Sparkles } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useAdminRole } from "@/hooks/useAdminRole";

const baseNavItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Analyze", path: "/upload" },
  { icon: Sparkles, label: "Picks", path: "/suggestions" },
  { icon: Scale, label: "Compare", path: "/compare" },
  { icon: User, label: "Profile", path: "/profile" },
];

export function BottomNav() {
  const location = useLocation();
  const { isAdmin } = useAdminRole();

  // For admins, replace Compare with Admin to keep 5 items max
  const navItems = isAdmin 
    ? [
        baseNavItems[0], // Home
        baseNavItems[1], // Analyze  
        baseNavItems[2], // Picks
        { icon: Shield, label: "Admin", path: "/admin" },
        baseNavItems[4], // Profile
      ]
    : baseNavItems;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around py-1.5 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 px-4 min-h-[52px] min-w-[64px] rounded-xl transition-all duration-150 active:scale-95",
                isActive 
                  ? "text-primary" 
                  : "text-muted-foreground hover:text-foreground active:bg-muted/50"
              )}
            >
              <Icon 
                className={cn(
                  "w-6 h-6 transition-all duration-150", 
                  isActive && "text-primary drop-shadow-[0_0_10px_hsl(var(--primary))]"
                )} 
              />
              <span className={cn(
                "text-[10px] font-medium transition-colors",
                isActive && "text-primary"
              )}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
