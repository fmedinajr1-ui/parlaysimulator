import { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ParlayFarmLogo } from "@/components/ParlayFarmLogo";

interface MobileHeaderProps {
  title: string;
  subtitle?: string;
  icon?: ReactNode;
  showBack?: boolean;
  backTo?: string;
  rightAction?: ReactNode;
  className?: string;
  sticky?: boolean;
  showLogo?: boolean;
}

export function MobileHeader({ 
  title, 
  subtitle,
  icon,
  showBack = false,
  backTo,
  rightAction,
  className,
  sticky = true,
  showLogo = true
}: MobileHeaderProps) {
  const navigate = useNavigate();

  const handleBack = () => {
    if (backTo) {
      navigate(backTo);
    } else if (window.history.length > 1) {
      navigate(-1);
    } else {
      navigate('/');
    }
  };

  return (
    <header className={cn(
      "pt-safe bg-background/95 backdrop-blur-xl z-50",
      sticky && "sticky top-0",
      className
    )}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-border/50">
        <div className="flex items-center gap-3 flex-1 min-w-0">
          {showBack && (
            <Button
              variant="ghost"
              size="icon"
              className="shrink-0 -ml-2 h-10 w-10"
              onClick={handleBack}
            >
              <ChevronLeft className="w-6 h-6" />
            </Button>
          )}
          {showLogo && !showBack && (
            <ParlayFarmLogo size="sm" className="shrink-0" />
          )}
          {icon && (
            <div className="shrink-0">
              {icon}
            </div>
          )}
          <div className="min-w-0">
            <h1 className="font-display text-xl tracking-wide text-foreground truncate">
              {title}
            </h1>
            {subtitle && (
              <p className="text-xs text-muted-foreground truncate">
                {subtitle}
              </p>
            )}
          </div>
        </div>
        {rightAction && (
          <div className="shrink-0 ml-3">
            {rightAction}
          </div>
        )}
      </div>
    </header>
  );
}
