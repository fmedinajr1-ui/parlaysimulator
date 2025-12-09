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
  Flame
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";

const menuItems = [
  { icon: Sparkles, label: "AI Picks", path: "/suggestions", description: "Smart betting suggestions" },
  { icon: Flame, label: "Hit Rate", path: "/hitrate", description: "X/5 streak patterns" },
  { icon: Flame, label: "God Mode Upsets", path: "/god-mode", description: "AI upset predictions" },
  { icon: Zap, label: "GOD MODE Tracker", path: "/god-mode-tracker", description: "Sharp vs Vegas intel" },
  { icon: Activity, label: "Sharp Money", path: "/sharp", description: "Track sharp action" },
  { icon: Activity, label: "NBA Fatigue", path: "/nba-fatigue", description: "Team fatigue analysis" },
  { icon: GitCompare, label: "Compare Parlays", path: "/compare", description: "Head-to-head comparison" },
  { icon: Search, label: "Line Shopping", path: "/line-shopping", description: "Find best odds" },
  { icon: Download, label: "Install App", path: "/install", description: "Get the mobile app" },
];

const adminItems = [
  { icon: Calculator, label: "PVS Calculator", path: "/pvs-calculator", description: "Prop value scoring" },
  { icon: Shield, label: "Admin Panel", path: "/admin", description: "System management" },
  { icon: Users, label: "Collaborators", path: "/collaborate", description: "Team access" },
];

export function MenuDrawer() {
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();

  // Check admin role directly without using the hook to avoid context issues
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

    // Subscribe to auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      checkAdminRole();
    });

    return () => subscription.unsubscribe();
  }, []);

  const isActive = (path: string) => location.pathname === path;

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
      
      <SheetContent side="left" className="w-[300px] p-0 bg-background">
        <SheetHeader className="p-6 pb-4 border-b border-border">
          <SheetTitle className="text-left font-display text-lg">Menu</SheetTitle>
        </SheetHeader>
        
        <div className="flex flex-col py-2">
          {/* Main Navigation */}
          <div className="px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
              Features
            </p>
            {menuItems.map((item) => (
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
