import * as React from "react";
import { cn } from "@/lib/utils";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerClose,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";

interface MobileDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  icon?: React.ReactNode;
  iconColorClass?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function MobileDetailDrawer({
  open,
  onOpenChange,
  title,
  description,
  icon,
  iconColorClass,
  children,
  footer,
}: MobileDetailDrawerProps) {
  const { lightTap } = useHapticFeedback();

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      lightTap();
    }
    onOpenChange(newOpen);
  };

  return (
    <Drawer open={open} onOpenChange={handleOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <div className="mx-auto w-full max-w-lg">
          <DrawerHeader className="relative">
            <DrawerClose asChild>
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-2 top-2 h-8 w-8 rounded-full"
              >
                <X className="h-4 w-4" />
              </Button>
            </DrawerClose>
            
            <div className="flex items-center gap-3">
              {icon && (
                <div className={cn(
                  "p-2 rounded-lg bg-muted/50",
                  iconColorClass
                )}>
                  {icon}
                </div>
              )}
              <div className="text-left">
                <DrawerTitle className="text-lg font-display">
                  {title}
                </DrawerTitle>
                {description && (
                  <DrawerDescription className="text-sm mt-0.5">
                    {description}
                  </DrawerDescription>
                )}
              </div>
            </div>
          </DrawerHeader>
          
          <div className="px-4 pb-4 overflow-y-auto max-h-[60vh]">
            {children}
          </div>
          
          {footer && (
            <div className="px-4 pb-6 pt-2 border-t border-border/50">
              {footer}
            </div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
