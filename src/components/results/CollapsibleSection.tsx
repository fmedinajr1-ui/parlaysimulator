import { ReactNode, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface CollapsibleSectionProps {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  preview?: ReactNode;
  children: ReactNode;
  className?: string;
  badge?: ReactNode;
}

export function CollapsibleSection({
  title,
  icon,
  defaultOpen = false,
  preview,
  children,
  className,
  badge
}: CollapsibleSectionProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className={cn("rounded-xl border border-border/50 bg-card/30 overflow-hidden", className)}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full p-4 flex items-center justify-between text-left hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {icon}
          <span className="font-display text-sm uppercase tracking-wider text-foreground">{title}</span>
          {badge}
        </div>
        {isOpen ? (
          <ChevronUp className="w-5 h-5 text-muted-foreground" />
        ) : (
          <ChevronDown className="w-5 h-5 text-muted-foreground" />
        )}
      </button>

      {/* Preview when collapsed */}
      {!isOpen && preview && (
        <div className="px-4 pb-4 pt-0">
          {preview}
        </div>
      )}

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 space-y-3">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
