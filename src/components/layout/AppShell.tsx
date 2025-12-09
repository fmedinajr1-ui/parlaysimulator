import { ReactNode } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopLayout } from "./DesktopLayout";
import { MobileLayout } from "./MobileLayout";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function AppShell({ children, className, noPadding = false }: AppShellProps) {
  const isMobile = useIsMobile();

  // Show mobile layout on mobile devices
  if (isMobile) {
    return (
      <MobileLayout className={className} noPadding={noPadding}>
        {children}
      </MobileLayout>
    );
  }

  // Show desktop layout with sidebar on larger screens
  return (
    <DesktopLayout className={className} noPadding={noPadding}>
      {children}
    </DesktopLayout>
  );
}
