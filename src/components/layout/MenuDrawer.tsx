import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { 
  Menu, 
  Sparkles, 
  Zap, 
  Activity, 
  GitCompare, 
  Search, 
  Download,
  Calculator,
  Shield,
  Users,
  ChevronRight,
  ChevronDown,
  Flame,
  ScanSearch,
  Wallet,
  TrendingUp,
  BarChart3,
  Target,
  Lock
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PILOT_ALLOWED_ROUTES } from "@/components/PilotRouteGuard";
import { usePilotUser } from "@/hooks/usePilotUser";

const menuGroups = [
  {
    label: "Bankroll Tools",
    icon: Wallet,
    defaultOpen: true,
    items: [
      { icon: Wallet, label: "Kelly Calculator", path: "/kelly", description: "Optimal stake sizing" },
      { icon: TrendingUp, label: "Odds Movement", path: "/odds", description: "Track line changes" },
      { icon: Search, label: "Line Shopping", path: "/line-shopping", description: "Find best odds" },
    ]
  },
  {
    label: "Analysis Engines",
    icon: Target,
    defaultOpen: true,
    items: [
      { icon: Sparkles, label: "AI Picks", path: "/suggestions", description: "Smart betting suggestions" },
      { icon: Flame, label: "Hit Rate", path: "/hitrate", description: "X/5 streak patterns" },
      { icon: Activity, label: "Sharp Money", path: "/sharp", description: "Track sharp action" },
      { icon: ScanSearch, label: "FanDuel Scanner", path: "/fanduel-traps", description: "Trap line detection" },
    ]
  },
  {
    label: "Trackers",
    icon: BarChart3,
    defaultOpen: false,
    items: [
      { icon: Flame, label: "God Mode Upsets", path: "/god-mode", description: "AI upset predictions" },
      { icon: Zap, label: "GOD MODE Tracker", path: "/god-mode-tracker", description: "Sharp vs Vegas intel" },
      { icon: Activity, label: "NBA Fatigue", path: "/nba-fatigue", description: "Team fatigue analysis" },
    ]
  },
  {
    label: "Utilities",
    icon: Calculator,
    defaultOpen: false,
    items: [
      { icon: GitCompare, label: "Compare Parlays", path: "/compare", description: "Head-to-head comparison" },
      { icon: Download, label: "Install App", path: "/install", description: "Get the mobile app" },
    ]
  },
];

const adminItems = [
  { icon: Activity, label: "All-Sports Tracker", path: "/tracker", description: "Real-time picks from all engines" },
  { icon: Calculator, label: "PVS Calculator", path: "/pvs-calculator", description: "Prop value scoring" },
  { icon: Shield, label: "Admin Panel", path: "/admin", description: "System management" },
  { icon: Users, label: "Collaborators", path: "/collaborate", description: "Team access" },
];

export function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const [isAdminRole, setIsAdminRole] = useState(false);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const location = useLocation();
  
  // Use the centralized pilot user hook
  const { isPilotUser, isAdmin: isPilotAdmin, isSubscribed } = usePilotUser();

  // Initialize open groups
  useEffect(() => {
    const initial: Record<string, boolean> = {};
    menuGroups.forEach(group => {
      initial[group.label] = group.defaultOpen;
    });
    setOpenGroups(initial);
  }, []);

  // Check admin role from database
  useEffect(() => {
    const checkAdminRole = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) {
          setIsAdminRole(false);
          return;
        }

        const { data } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', session.user.id)
          .eq('role', 'admin')
          .maybeSingle();

        setIsAdminRole(!!data);
      } catch (err) {
        console.error('Error checking admin role:', err);
        setIsAdminRole(false);
      }
    };

    checkAdminRole();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAdminRole();
    });

    return () => subscription.unsubscribe();
  }, []);

  const isActive = (path: string) => location.pathname === path;

  const toggleGroup = (label: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [label]: !prev[label]
    }));
  };

  // Combine admin checks and determine restriction
  const isAdmin = isAdminRole || isPilotAdmin;
  const isPilotRestricted = isPilotUser && !isAdmin && !isSubscribed;
  
  // Filter menu groups for pilot users
  const filteredMenuGroups = isPilotRestricted
    ? menuGroups.map(group => ({
        ...group,
        items: group.items.filter(item => PILOT_ALLOWED_ROUTES.includes(item.path))
      })).filter(group => group.items.length > 0)
    : menuGroups;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className={cn(
            "relative flex flex-col items-center justify-center gap-0.5",
            "flex-1 h-full max-w-[80px]",
            "transition-all duration-200 active:scale-95",
            "touch-manipulation select-none",
            "text-muted-foreground active:text-foreground"
          )}
        >
          <div className="relative flex items-center justify-center w-12 h-8 rounded-2xl">
            <Menu className="w-[22px] h-[22px]" />
          </div>
          <span className="text-[11px] font-semibold">More</span>
        </button>
      </SheetTrigger>
      
      <SheetContent side="left" className="w-[300px] p-0 bg-background overflow-y-auto">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle className="text-left font-display text-lg">Menu</SheetTitle>
        </SheetHeader>
        
        <div className="flex flex-col py-2">
          {/* Pilot User Notice */}
          {isPilotRestricted && (
            <div className="mx-3 mb-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
              <div className="flex items-center gap-2 text-sm">
                <Lock className="w-4 h-4 text-primary" />
                <span className="font-medium text-primary">Pilot Mode</span>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                Upgrade to unlock all features
              </p>
            </div>
          )}

          {/* Grouped Navigation */}
          {filteredMenuGroups.map((group) => (
            <Collapsible 
              key={group.label}
              open={openGroups[group.label]} 
              onOpenChange={() => toggleGroup(group.label)}
              className="px-3 py-1"
            >
              <CollapsibleTrigger className="flex items-center justify-between w-full px-3 py-2 rounded-lg hover:bg-muted/50 transition-colors">
                <div className="flex items-center gap-2">
                  <group.icon className="w-4 h-4 text-primary" />
                  <span className="text-sm font-medium">{group.label}</span>
                </div>
                <ChevronDown className={cn(
                  "w-4 h-4 text-muted-foreground transition-transform duration-200",
                  openGroups[group.label] && "rotate-180"
                )} />
              </CollapsibleTrigger>
              <CollapsibleContent className="pl-2 mt-1 space-y-0.5">
                {group.items.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors",
                      "hover:bg-muted/50 active:bg-muted",
                      isActive(item.path) && "bg-primary/10 text-primary"
                    )}
                  >
                    <item.icon className={cn(
                      "w-4 h-4",
                      isActive(item.path) ? "text-primary" : "text-muted-foreground"
                    )} />
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium truncate",
                        isActive(item.path) && "text-primary"
                      )}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{item.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/50 shrink-0" />
                  </Link>
                ))}
              </CollapsibleContent>
            </Collapsible>
          ))}
          
          {/* Admin Section */}
          {isAdmin && (
            <>
              <Separator className="my-2" />
              <div className="px-3 py-2">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
                  Admin Tools
                </p>
                {adminItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-3 rounded-lg transition-colors",
                      "hover:bg-muted/50 active:bg-muted",
                      isActive(item.path) && "bg-primary/10 text-primary"
                    )}
                  >
                    <item.icon className={cn(
                      "w-5 h-5",
                      isActive(item.path) ? "text-primary" : "text-muted-foreground"
                    )} />
                    <div className="flex-1">
                      <p className={cn(
                        "text-sm font-medium",
                        isActive(item.path) && "text-primary"
                      )}>
                        {item.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{item.description}</p>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
                  </Link>
                ))}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
