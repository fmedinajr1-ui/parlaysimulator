import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

interface GradeRevealProps {
  letter: string;
  headline: string;
  composite: number;
  className?: string;
}

const GRADE_STYLES: Record<string, string> = {
  A: "from-emerald-500/30 to-emerald-700/10 border-emerald-500/50 text-emerald-400",
  B: "from-lime-500/30 to-lime-700/10 border-lime-500/50 text-lime-400",
  C: "from-amber-500/30 to-amber-700/10 border-amber-500/50 text-amber-400",
  D: "from-orange-500/30 to-orange-700/10 border-orange-500/50 text-orange-400",
  F: "from-destructive/40 to-destructive/10 border-destructive/60 text-destructive",
};

export function GradeReveal({ letter, headline, composite, className }: GradeRevealProps) {
  const style = GRADE_STYLES[letter] || GRADE_STYLES.C;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.85 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ type: "spring", stiffness: 200, damping: 18 }}
      className={cn(
        "relative rounded-2xl border-2 bg-gradient-to-br p-6 sm:p-8 text-center overflow-hidden",
        style,
        className,
      )}
    >
      <div className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">
        Verdict
      </div>
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15 }}
        className="font-display text-[120px] sm:text-[160px] font-black leading-none mb-2"
      >
        {letter}
      </motion.div>
      <div className="text-xs text-muted-foreground mb-4 font-mono">
        Score: {composite}/100
      </div>
      <motion.p
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-base sm:text-lg font-semibold text-foreground italic px-2"
      >
        "{headline}"
      </motion.p>
    </motion.div>
  );
}
