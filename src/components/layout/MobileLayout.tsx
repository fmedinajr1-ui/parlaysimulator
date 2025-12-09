import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface MobileLayoutProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function MobileLayout({ children, className, noPadding = false }: MobileLayoutProps) {
  return (
    <div className={cn(
      "min-h-dvh flex flex-col bg-background",
      className
    )}>
      <main className={cn(
        "flex-1 flex flex-col max-w-lg mx-auto w-full pb-[88px]",
        !noPadding && "px-4 py-4"
      )}>
        {children}
      </main>
    </div>
  );
}
