import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface DesktopLayoutProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function DesktopLayout({ children, className, noPadding = false }: DesktopLayoutProps) {
  return (
    <div className="min-h-screen w-full bg-background">
      <main className={cn(
        "flex-1 flex flex-col min-h-screen overflow-x-hidden",
        !noPadding && "p-6",
        className
      )}>
        <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col">
          {children}
        </div>
      </main>
    </div>
  );
}
