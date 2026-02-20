import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { Menu, X, Target, Users, Eye, Activity, Calculator, Shield, ChevronRight, LayoutDashboard } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { usePilotUser } from "@/hooks/usePilotUser";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";

const menuItems = [
  { icon: Target, label: "Analysis", path: "/sweet-spots", description: "Sweet spot analysis" },
  { icon: Users, label: "Team Bets", path: "/team-bets", description: "NCAAB spreads, totals & ML" },
  { icon: Eye, label: "Scout", path: "/scout", description: "AI video analysis" },
  { icon: LayoutDashboard, label: "Dashboard", path: "/dashboard", description: "Bot dashboard" },
];

const adminItems = [
  { icon: Activity, label: "Tracker", path: "/tracker", description: "Real-time picks" },
  { icon: Calculator, label: "PVS Calculator", path: "/pvs-calculator", description: "Prop value scoring" },
  { icon: Shield, label: "Admin", path: "/admin", description: "System management" },
];

export function MobileFloatingMenu() {
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const location = useLocation();
  const { isAdmin: isPilotAdmin } = usePilotUser();
  const haptics = useHapticFeedback();

  useEffect(() => {
    const checkAdmin = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return setIsAdmin(false);
      const { data } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', session.user.id)
        .eq('role', 'admin')
        .maybeSingle();
      setIsAdmin(!!data);
    };
    checkAdmin();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => checkAdmin());
    return () => subscription.unsubscribe();
  }, []);

  const showAdmin = isAdmin || isPilotAdmin;
  const isActive = (path: string) => location.pathname === path;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          onClick={() => haptics.lightTap()}
          className={cn(
            "fixed top-4 right-4 z-50 md:hidden",
            "w-11 h-11 rounded-full",
            "bg-background/80 backdrop-blur-xl",
            "border border-border/60",
            "shadow-lg shadow-black/20",
            "flex items-center justify-center",
            "transition-all duration-200 active:scale-90",
            "touch-manipulation"
          )}
        >
          {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </SheetTrigger>
      
      <SheetContent 
        side="right" 
        className="w-[280px] p-0 bg-background/95 backdrop-blur-2xl border-l border-border/40"
      >
        <div className="flex flex-col pt-16 pb-8">
          <div className="px-4 space-y-1">
            {menuItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => { setOpen(false); haptics.lightTap(); }}
                className={cn(
                  "flex items-center gap-3 px-3 py-3 rounded-xl transition-all",
                  "active:scale-[0.98]",
                  isActive(item.path)
                    ? "bg-primary/10 text-primary"
                    : "text-foreground hover:bg-muted/50"
                )}
              >
                <item.icon className={cn(
                  "w-5 h-5",
                  isActive(item.path) ? "text-primary" : "text-muted-foreground"
                )} />
                <div className="flex-1">
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-muted-foreground">{item.description}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
              </Link>
            ))}
          </div>

          {showAdmin && (
            <>
              <Separator className="my-3 mx-4" />
              <div className="px-4 space-y-1">
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-widest px-3 mb-1">
                  Admin
                </p>
                {adminItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all",
                      isActive(item.path)
                        ? "bg-primary/10 text-primary"
                        : "text-foreground hover:bg-muted/50"
                    )}
                  >
                    <item.icon className={cn(
                      "w-4 h-4",
                      isActive(item.path) ? "text-primary" : "text-muted-foreground"
                    )} />
                    <p className="text-sm font-medium">{item.label}</p>
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
