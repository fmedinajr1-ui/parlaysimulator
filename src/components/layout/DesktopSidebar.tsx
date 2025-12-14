import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { 
  Home, 
  BarChart3, 
  User, 
  TrendingUp,
  Sparkles, 
  Zap, 
  Activity, 
  GitCompare, 
  Search, 
  Download,
  Calculator,
  Shield,
  Users,
  Flame,
  PanelLeftClose,
  PanelLeft,
  ScanSearch
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const mainNavItems = [
  { icon: Home, label: "Home", path: "/" },
  { icon: BarChart3, label: "Analyze", path: "/upload" },
  { icon: TrendingUp, label: "Odds", path: "/odds" },
  { icon: User, label: "Profile", path: "/profile" },
];

const featureItems = [
  { icon: Sparkles, label: "AI Picks", path: "/suggestions" },
  { icon: Flame, label: "Hit Rate", path: "/hitrate" },
  { icon: Flame, label: "God Mode Upsets", path: "/god-mode" },
  { icon: Zap, label: "GOD MODE Tracker", path: "/god-mode-tracker" },
  { icon: ScanSearch, label: "FanDuel Scanner", path: "/fanduel-traps" },
  { icon: Activity, label: "Sharp Money", path: "/sharp" },
  { icon: Activity, label: "NBA Fatigue", path: "/nba-fatigue" },
  { icon: GitCompare, label: "Compare Parlays", path: "/compare" },
  { icon: Search, label: "Line Shopping", path: "/line-shopping" },
  { icon: Download, label: "Install App", path: "/install" },
];

const adminItems = [
  { icon: Activity, label: "All-Sports Tracker", path: "/tracker" },
  { icon: Calculator, label: "PVS Calculator", path: "/pvs-calculator" },
  { icon: Shield, label: "Admin Panel", path: "/admin" },
  { icon: Users, label: "Collaborators", path: "/collaborate" },
];

interface DesktopSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

export function DesktopSidebar({ collapsed, onToggle }: DesktopSidebarProps) {
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const checkAdminRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setIsAdmin(false);
          return;
        }

        const { data } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .eq('role', 'admin')
          .maybeSingle();

        setIsAdmin(!!data);
      } catch (err) {
        console.error('Error checking admin role:', err);
        setIsAdmin(false);
      }
    };

    checkAdminRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAdminRole();
    });

    return () => subscription.unsubscribe();
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const NavItem = ({ icon: Icon, label, path }: { icon: typeof Home; label: string; path: string }) => {
    const active = isActive(path);
    
    const linkContent = (
      <Link
        to={path}
        className={cn(
          "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-200",
          "hover:bg-muted/50",
          active && "bg-primary/10 text-primary",
          collapsed && "justify-center px-2"
        )}
      >
        <Icon className={cn(
          "w-5 h-5 shrink-0",
          active ? "text-primary" : "text-muted-foreground"
        )} />
        {!collapsed && (
          <span className={cn(
            "text-sm font-medium truncate",
            active ? "text-primary" : "text-foreground"
          )}>
            {label}
          </span>
        )}
      </Link>
    );

    if (collapsed) {
      return (
        <Tooltip delayDuration={0}>
          <TooltipTrigger asChild>
            {linkContent}
          </TooltipTrigger>
          <TooltipContent side="right" className="font-medium">
            {label}
          </TooltipContent>
        </Tooltip>
      );
    }

    return linkContent;
  };

  return (
    <aside className={cn(
      "h-screen bg-background border-r border-border flex flex-col transition-all duration-300",
      collapsed ? "w-16" : "w-60"
    )}>
      {/* Header */}
      <div className={cn(
        "h-14 flex items-center border-b border-border px-4",
        collapsed ? "justify-center" : "justify-between"
      )}>
        {!collapsed && (
          <span className="font-display font-bold text-lg text-primary">
            ParlayEdge
          </span>
        )}
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggle}
          className="h-8 w-8 shrink-0"
        >
          {collapsed ? (
            <PanelLeft className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto py-4 px-2">
        {/* Main Nav */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
              Main
            </p>
          )}
          {mainNavItems.map((item) => (
            <NavItem key={item.path} {...item} />
          ))}
        </div>

        <Separator className="my-4" />

        {/* Features */}
        <div className="space-y-1">
          {!collapsed && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
              Features
            </p>
          )}
          {featureItems.map((item) => (
            <NavItem key={item.path} {...item} />
          ))}
        </div>

        {/* Admin Section */}
        {isAdmin && (
          <>
            <Separator className="my-4" />
            <div className="space-y-1">
              {!collapsed && (
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
                  Admin
                </p>
              )}
              {adminItems.map((item) => (
                <NavItem key={item.path} {...item} />
              ))}
            </div>
          </>
        )}
      </div>

      {/* Footer */}
      <div className={cn(
        "p-4 border-t border-border",
        collapsed && "p-2"
      )}>
        {!collapsed && (
          <p className="text-xs text-muted-foreground text-center">
            Press <kbd className="px-1.5 py-0.5 rounded bg-muted text-xs">⌘B</kbd> to toggle
          </p>
        )}
      </div>
    </aside>
  );
}
