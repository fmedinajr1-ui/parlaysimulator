import React, { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { 
  Menu, 
  Activity, 
  Calculator,
  Shield,
  Users,
  ChevronRight,
  Hammer,
  Target
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Separator } from "@/components/ui/separator";
import { usePilotUser } from "@/hooks/usePilotUser";
import { useViewport } from "@/hooks/useViewport";

const toolItems = [
  { icon: Hammer, label: "Manual Builder", path: "/manual-builder", description: "Build custom parlays manually" },
  { icon: Target, label: "Tomorrow's 3PT", path: "/tomorrow-3pt", description: "3PT shooter picks for tomorrow" },
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
  const location = useLocation();
  const { isSmallPhone, isMediumPhone } = useViewport();
  const isMobileCompact = isSmallPhone || isMediumPhone;
  
  // Use the centralized pilot user hook
  const { isAdmin: isPilotAdmin } = usePilotUser();

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
  const isAdmin = isAdminRole || isPilotAdmin;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          className={cn(
            "relative flex flex-col items-center justify-center gap-0.5",
            "flex-1 h-full",
            isSmallPhone ? "max-w-[56px]" : "max-w-[80px]",
            "transition-all duration-200 active:scale-95",
            "touch-manipulation select-none",
            "text-muted-foreground active:text-foreground"
          )}
        >
          <div className={cn(
            "relative flex items-center justify-center rounded-2xl",
            isSmallPhone ? "w-10 h-7" : "w-12 h-8"
          )}>
            <Menu className={cn(
              isSmallPhone ? "w-5 h-5" : "w-[22px] h-[22px]"
            )} />
          </div>
          {!isSmallPhone && (
            <span className="text-[11px] font-semibold">More</span>
          )}
        </button>
      </SheetTrigger>
      
      <SheetContent 
        side="left" 
        className={cn(
          "p-0 bg-background overflow-y-auto",
          isSmallPhone ? "w-[260px]" : "w-[300px]"
        )}
      >
        <SheetHeader className={cn(
          "border-b border-border",
          isMobileCompact ? "p-4 pb-3" : "p-6 pb-4"
        )}>
          <div className="flex items-center gap-3">
            <img 
              src="/parlay-farm-logo.png" 
              alt="Parlay Farm" 
              className="h-10 w-auto"
            />
            <SheetTitle className="text-left font-display text-lg">Menu</SheetTitle>
          </div>
        </SheetHeader>
        
        <div className="flex flex-col py-2">
          {/* Tools Section - Available to all users */}
          <div className={cn("px-3", isMobileCompact ? "py-1" : "py-2")}>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
              Tools
            </p>
            {toolItems.map((item) => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setOpen(false)}
                className={cn(
                  "flex items-center gap-3 px-3 rounded-lg transition-colors",
                  "hover:bg-muted/50 active:bg-muted",
                  isActive(item.path) && "bg-primary/10 text-primary",
                  isMobileCompact ? "py-2" : "py-3"
                )}
              >
                <item.icon className={cn(
                  isMobileCompact ? "w-4 h-4" : "w-5 h-5",
                  isActive(item.path) ? "text-primary" : "text-muted-foreground"
                )} />
                <div className="flex-1">
                  <p className={cn(
                    "text-sm font-medium",
                    isActive(item.path) && "text-primary"
                  )}>
                    {item.label}
                  </p>
                  {!isMobileCompact && (
                    <p className="text-xs text-muted-foreground">{item.description}</p>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-muted-foreground/50" />
              </Link>
            ))}
          </div>

          {/* Admin Section */}
          {isAdmin && (
            <>
              <Separator className="my-2" />
              <div className={cn("px-3", isMobileCompact ? "py-1" : "py-2")}>
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide px-3 mb-2">
                  Admin Tools
                </p>
                {adminItems.map((item) => (
                  <Link
                    key={item.path}
                    to={item.path}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center gap-3 px-3 rounded-lg transition-colors",
                      "hover:bg-muted/50 active:bg-muted",
                      isActive(item.path) && "bg-primary/10 text-primary",
                      isMobileCompact ? "py-2" : "py-3"
                    )}
                  >
                    <item.icon className={cn(
                      isMobileCompact ? "w-4 h-4" : "w-5 h-5",
                      isActive(item.path) ? "text-primary" : "text-muted-foreground"
                    )} />
                    <div className="flex-1">
                      <p className={cn(
                        "text-sm font-medium",
                        isActive(item.path) && "text-primary"
                      )}>
                        {item.label}
                      </p>
                      {!isMobileCompact && (
                        <p className="text-xs text-muted-foreground">{item.description}</p>
                      )}
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
