import { Home, BarChart3, User } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Analyze", path: "/upload" },
  { icon: User, label: "Profile", path: "/profile", disabled: true },
];

export function BottomNav() {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-xl border-t border-border safe-area-bottom">
      <div className="flex items-center justify-around py-1.5 px-2 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          const Icon = item.icon;

          if (item.disabled) {
            return (
              <div
                key={item.path}
                className="flex flex-col items-center justify-center gap-0.5 py-2 px-5 min-h-[52px] min-w-[64px] opacity-40 cursor-not-allowed"
              >
                <Icon className="w-6 h-6 text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground font-medium">{item.label}</span>
              </div>
            );
          }

          return (
            <Link
              key={item.path}
              to={item.path}
              className={cn(
                "flex flex-col items-center justify-center gap-0.5 py-2 px-5 min-h-[52px] min-w-[64px] rounded-xl transition-all duration-150 active:scale-95",
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
