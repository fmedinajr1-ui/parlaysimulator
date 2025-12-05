import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function AppShell({ children, className, noPadding = false }: AppShellProps) {
  return (
    <div className={cn(
      "min-h-dvh bg-background pb-nav-safe overflow-x-safe scroll-smooth-ios",
      className
    )}>
      <main className={cn(
        "max-w-lg mx-auto",
        !noPadding && "px-4 py-4"
      )}>
        {children}
      </main>
    </div>
  );
}
