import { Dog } from 'lucide-react';
import { cn } from '@/lib/utils';

interface DogAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'winner' | 'underdog';
  className?: string;
  animated?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
};

const iconSizes = {
  sm: 16,
  md: 20,
  lg: 28,
};

export function DogAvatar({ 
  size = 'md', 
  variant = 'default',
  className,
  animated = false 
}: DogAvatarProps) {
  const variantClasses = {
    default: 'bg-farm-dog/20 text-farm-dog border-farm-dog/30',
    winner: 'bg-neon-green/20 text-neon-green border-neon-green/50 shadow-[0_0_15px_hsl(var(--neon-green)/0.3)]',
    underdog: 'bg-neon-orange/20 text-neon-orange border-neon-orange/50',
  };

  return (
    <div 
      className={cn(
        'rounded-full border-2 flex items-center justify-center transition-all duration-300',
        sizeClasses[size],
        variantClasses[variant],
        animated && 'hover:animate-dog-wag',
        className
      )}
    >
      <Dog size={iconSizes[size]} strokeWidth={2} />
    </div>
  );
}

export function DogBadge({ 
  label, 
  variant = 'default' 
}: { 
  label: string; 
  variant?: 'top-dog' | 'good-boy' | 'underdog' | 'default';
}) {
  const badgeClasses = {
    'top-dog': 'bg-farm-gold/20 text-farm-gold border-farm-gold/50',
    'good-boy': 'bg-neon-green/20 text-neon-green border-neon-green/50',
    'underdog': 'bg-neon-orange/20 text-neon-orange border-neon-orange/50',
    'default': 'bg-farm-dog/20 text-farm-dog border-farm-dog/50',
  };

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      badgeClasses[variant]
    )}>
      <Dog size={12} />
      <span>{label}</span>
    </div>
  );
}
