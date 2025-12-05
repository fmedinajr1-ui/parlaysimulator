import { Dog, Trophy, TrendingUp, Star, Flame, Target } from 'lucide-react';
import { cn } from '@/lib/utils';

type BadgeType = 
  | 'top-dog' 
  | 'alpha-wolf' 
  | 'fresh-pick' 
  | 'hot-streak' 
  | 'verified-sharp'
  | 'underdog-special';

interface FarmBadgeProps {
  type: BadgeType;
  size?: 'sm' | 'md';
  className?: string;
}

const badgeConfig: Record<BadgeType, {
  label: string;
  icon: typeof Dog;
  classes: string;
}> = {
  'top-dog': {
    label: 'Top Dog',
    icon: Trophy,
    classes: 'bg-farm-gold/20 text-farm-gold border-farm-gold/50',
  },
  'alpha-wolf': {
    label: 'Alpha',
    icon: Star,
    classes: 'bg-primary/20 text-primary border-primary/50',
  },
  'fresh-pick': {
    label: 'Fresh',
    icon: Target,
    classes: 'bg-neon-green/20 text-neon-green border-neon-green/50',
  },
  'hot-streak': {
    label: 'Hot',
    icon: Flame,
    classes: 'bg-neon-orange/20 text-neon-orange border-neon-orange/50',
  },
  'verified-sharp': {
    label: 'Verified',
    icon: TrendingUp,
    classes: 'bg-farm-wolf/20 text-farm-wolf border-farm-wolf/50',
  },
  'underdog-special': {
    label: 'Underdog',
    icon: Dog,
    classes: 'bg-farm-dog/20 text-farm-dog border-farm-dog/50',
  },
};

export function FarmBadge({ type, size = 'sm', className }: FarmBadgeProps) {
  const config = badgeConfig[type];
  const Icon = config.icon;

  return (
    <div className={cn(
      'inline-flex items-center gap-1 rounded-full border font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      config.classes,
      className
    )}>
      <Icon size={size === 'sm' ? 10 : 12} />
      <span>{config.label}</span>
    </div>
  );
}
