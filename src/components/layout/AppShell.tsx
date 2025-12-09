import React, { ReactNode } from "react";
import { DesktopLayout } from "./DesktopLayout";
import { MobileLayout } from "./MobileLayout";

interface AppShellProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function AppShell({ children, className, noPadding = false }: AppShellProps) {
  const [isMobile, setIsMobile] = React.useState(false);
  
  React.useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    const mql = window.matchMedia("(max-width: 767px)");
    mql.addEventListener("change", checkMobile);
    return () => mql.removeEventListener("change", checkMobile);
  }, []);

  if (isMobile) {
    return (
      <MobileLayout className={className} noPadding={noPadding}>
        {children}
      </MobileLayout>
    );
  }

  return (
    <DesktopLayout className={className} noPadding={noPadding}>
      {children}
    </DesktopLayout>
  );
}
