import { ReactNode, useState, useEffect, useCallback } from "react";
import { DesktopSidebar } from "./DesktopSidebar";
import { DesktopBottomNav } from "./DesktopBottomNav";
import { cn } from "@/lib/utils";

interface DesktopLayoutProps {
  children: ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function DesktopLayout({ children, className, noPadding = false }: DesktopLayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar-collapsed');
    return saved === 'true';
  });

  const toggleSidebar = useCallback(() => {
    setCollapsed(prev => {
      const newValue = !prev;
      localStorage.setItem('sidebar-collapsed', String(newValue));
      return newValue;
    });
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + B
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        toggleSidebar();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  return (
    <div className="min-h-screen flex w-full bg-background">
      <DesktopSidebar collapsed={collapsed} onToggle={toggleSidebar} />
      
      <main className={cn(
        "flex-1 flex flex-col min-h-screen overflow-x-hidden pb-20",
        !noPadding && "p-6",
        className
      )}>
        <div className="w-full max-w-7xl mx-auto flex-1 flex flex-col">
          {children}
        </div>
      </main>

      <DesktopBottomNav />
    </div>
  );
}
