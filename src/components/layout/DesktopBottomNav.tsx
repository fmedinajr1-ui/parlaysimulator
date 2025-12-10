import { Link, useLocation } from "react-router-dom";
import { Home, TrendingUp, DollarSign, User } from "lucide-react";
import { MenuDrawer } from "./MenuDrawer";
import { cn } from "@/lib/utils";

const navItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: TrendingUp, label: "Analyze", path: "/upload" },
  { icon: DollarSign, label: "Odds", path: "/odds-movement" },
  { icon: User, label: "Profile", path: "/profile" },
];

export function DesktopBottomNav() {
  const location = useLocation();

  const handleClick = (path: string) => {
    if (location.pathname === path) {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <nav className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 bg-background/95 backdrop-blur-xl border border-border/50 rounded-full shadow-lg px-2">
      <div className="flex items-center gap-1 h-14">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path;
          return (
            <Link
              key={item.path}
              to={item.path}
              onClick={() => handleClick(item.path)}
              className={cn(
                "flex items-center gap-2 px-4 py-2 rounded-full transition-all duration-200",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
              )}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          );
        })}
        <div className="pl-1">
          <MenuDrawer />
        </div>
      </div>
    </nav>
  );
}
