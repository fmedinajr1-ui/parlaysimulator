import { cn } from "@/lib/utils";
import { Scan } from "lucide-react";
import { motion } from "framer-motion";
import { useRef, useEffect, useState } from "react";

interface ScanBalanceBadgeProps {
  scansRemaining: number;
  totalScans?: number;
  showIcon?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  onClick?: () => void;
}

export function ScanBalanceBadge({ 
  scansRemaining, 
  totalScans = 5,
  showIcon = true,
  size = 'sm',
  className,
  onClick
}: ScanBalanceBadgeProps) {
  const percentage = (scansRemaining / totalScans) * 100;
  const prevScansRef = useRef(scansRemaining);
  const [shouldAnimate, setShouldAnimate] = useState(false);
  
  // Only animate when scans actually decrease (user action)
  useEffect(() => {
    if (prevScansRef.current > scansRemaining) {
      setShouldAnimate(true);
      const timer = setTimeout(() => setShouldAnimate(false), 300);
      return () => clearTimeout(timer);
    }
    prevScansRef.current = scansRemaining;
  }, [scansRemaining]);
  
  const getColorClass = () => {
    if (percentage > 60) return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (percentage > 30) return "bg-yellow-500/20 text-yellow-400 border-yellow-500/30";
    return "bg-red-500/20 text-red-400 border-red-500/30";
  };

  const sizeClasses = {
    sm: "text-[10px] px-1.5 py-0.5 gap-0.5",
    md: "text-xs px-2 py-1 gap-1"
  };

  return (
    <motion.button
      animate={shouldAnimate ? { scale: [1, 1.2, 1] } : { scale: 1 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border font-semibold transition-colors",
        "active:scale-95 touch-manipulation",
        sizeClasses[size],
        getColorClass(),
        onClick && "cursor-pointer hover:opacity-80",
        className
      )}
    >
      {showIcon && <Scan className={cn(size === 'sm' ? "w-2.5 h-2.5" : "w-3 h-3")} />}
      <span>{scansRemaining}</span>
    </motion.button>
  );
}
