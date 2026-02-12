import { useState, useEffect } from "react";
import { Link, useLocation } from "react-router-dom";
import { 
  Home, 
  Target,
  Activity, 
  Calculator,
  Shield,
  Users,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { usePilotUser } from "@/hooks/usePilotUser";

const mainNavItems = [
  { icon: Home, label: "Bot", path: "/" },
  { icon: Target, label: "Analysis", path: "/sweet-spots" },
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
  const [isAdminRole, setIsAdminRole] = useState(false);
  const location = useLocation();
  const { isPilotUser, isAdmin: isPilotAdmin, isSubscribed } = usePilotUser();

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
          <img 
            src="/parlay-farm-logo.png" 
            alt="Parlay Farm" 
            className="h-10 w-auto"
          />
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
