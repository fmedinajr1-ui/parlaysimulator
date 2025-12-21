import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";

interface CelebrationEffectProps {
  isActive: boolean;
  children: React.ReactNode;
}

interface Particle {
  id: number;
  x: number;
  y: number;
  color: string;
  size: number;
  rotation: number;
}

const COLORS = [
  'hsl(142, 71%, 45%)', // neon-green
  'hsl(187, 92%, 69%)', // neon-cyan
  'hsl(280, 67%, 60%)', // neon-purple
  'hsl(45, 93%, 47%)',  // gold
  'hsl(330, 90%, 60%)', // pink
];

const EMOJIS = ['🔥', '✅', '💰', '🎯', '⚡', '🏆'];

export function CelebrationEffect({ isActive, children }: CelebrationEffectProps) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const [showBanner, setShowBanner] = useState(false);
  const [floatingEmojis, setFloatingEmojis] = useState<{ id: number; emoji: string; x: number }[]>([]);

  useEffect(() => {
    if (isActive) {
      // Generate confetti particles
      const newParticles: Particle[] = Array.from({ length: 40 }).map((_, i) => ({
        id: i,
        x: Math.random() * 100,
        y: Math.random() * 100,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        size: Math.random() * 8 + 4,
        rotation: Math.random() * 360,
      }));
      setParticles(newParticles);

      // Show banner after short delay
      const bannerTimer = setTimeout(() => setShowBanner(true), 200);

      // Generate floating emojis
      const emojiInterval = setInterval(() => {
        setFloatingEmojis(prev => {
          if (prev.length >= 8) return prev;
          return [...prev, {
            id: Date.now() + Math.random(),
            emoji: EMOJIS[Math.floor(Math.random() * EMOJIS.length)],
            x: Math.random() * 80 + 10,
          }];
        });
      }, 300);

      // Clean up after animation
      const cleanupTimer = setTimeout(() => {
        setParticles([]);
        setFloatingEmojis([]);
      }, 4000);

      return () => {
        clearTimeout(bannerTimer);
        clearTimeout(cleanupTimer);
        clearInterval(emojiInterval);
      };
    } else {
      setShowBanner(false);
      setParticles([]);
      setFloatingEmojis([]);
    }
  }, [isActive]);

  return (
    <div className="relative">
      {/* Glow effect wrapper */}
      <div className={cn(
        "relative transition-all duration-500",
        isActive && "animate-pulse-glow rounded-2xl"
      )}>
        {children}
      </div>

      {/* Confetti particles */}
      <AnimatePresence>
        {particles.map((particle) => (
          <motion.div
            key={particle.id}
            className="absolute pointer-events-none z-50"
            initial={{
              left: `${particle.x}%`,
              top: '50%',
              scale: 0,
              rotate: 0,
              opacity: 1,
            }}
            animate={{
              top: `${-20 - Math.random() * 30}%`,
              left: `${particle.x + (Math.random() - 0.5) * 40}%`,
              scale: 1,
              rotate: particle.rotation,
              opacity: 0,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 1.5 + Math.random() * 1,
              ease: "easeOut",
            }}
            style={{
              width: particle.size,
              height: particle.size,
              backgroundColor: particle.color,
              borderRadius: Math.random() > 0.5 ? '50%' : '2px',
            }}
          />
        ))}
      </AnimatePresence>

      {/* Floating emojis */}
      <AnimatePresence>
        {floatingEmojis.map((emoji) => (
          <motion.div
            key={emoji.id}
            className="absolute pointer-events-none z-50 text-2xl"
            initial={{
              left: `${emoji.x}%`,
              bottom: '0%',
              opacity: 1,
              scale: 0.5,
            }}
            animate={{
              bottom: '120%',
              opacity: 0,
              scale: 1.2,
            }}
            exit={{ opacity: 0 }}
            transition={{
              duration: 2,
              ease: "easeOut",
            }}
          >
            {emoji.emoji}
          </motion.div>
        ))}
      </AnimatePresence>

      {/* "PERFECT PICKS" banner */}
      <AnimatePresence>
        {showBanner && isActive && (
          <motion.div
            className="absolute -top-3 left-1/2 z-50"
            initial={{ x: '-50%', y: -20, scale: 0, opacity: 0 }}
            animate={{ x: '-50%', y: 0, scale: 1, opacity: 1 }}
            exit={{ scale: 0, opacity: 0 }}
            transition={{
              type: "spring",
              stiffness: 400,
              damping: 15,
            }}
          >
            <div className="bg-gradient-to-r from-neon-green via-neon-cyan to-neon-green px-4 py-1.5 rounded-full shadow-lg shadow-neon-green/30">
              <span className="font-display text-sm text-background tracking-wider whitespace-nowrap flex items-center gap-1.5">
                <span className="text-lg">🔥</span>
                PERFECT PICKS
                <span className="text-lg">🔥</span>
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sparkle effects */}
      <AnimatePresence>
        {isActive && (
          <>
            {[0, 1, 2, 3].map((i) => (
              <motion.div
                key={`sparkle-${i}`}
                className="absolute pointer-events-none z-40"
                initial={{ opacity: 0, scale: 0 }}
                animate={{
                  opacity: [0, 1, 0],
                  scale: [0, 1, 0],
                }}
                transition={{
                  duration: 1,
                  delay: i * 0.3,
                  repeat: 2,
                  repeatDelay: 0.5,
                }}
                style={{
                  left: `${20 + i * 20}%`,
                  top: `${10 + (i % 2) * 80}%`,
                }}
              >
                <span className="text-xl">✨</span>
              </motion.div>
            ))}
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
