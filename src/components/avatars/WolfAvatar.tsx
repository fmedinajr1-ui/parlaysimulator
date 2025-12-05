import { cn } from '@/lib/utils';

interface WolfAvatarProps {
  size?: 'sm' | 'md' | 'lg';
  variant?: 'default' | 'alpha' | 'verified';
  className?: string;
  animated?: boolean;
}

const sizeClasses = {
  sm: 'w-8 h-8',
  md: 'w-10 h-10',
  lg: 'w-14 h-14',
};

const iconSizes = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-lg',
};

// Custom Wolf icon using SVG for sharp/premium look
function WolfIcon({ size }: { size: 'sm' | 'md' | 'lg' }) {
  const dimensions = { sm: 16, md: 20, lg: 28 };
  return (
    <svg 
      width={dimensions[size]} 
      height={dimensions[size]} 
      viewBox="0 0 24 24" 
      fill="none" 
      stroke="currentColor" 
      strokeWidth="2" 
      strokeLinecap="round" 
      strokeLinejoin="round"
    >
      {/* Wolf head silhouette */}
      <path d="M4 8l2-4 3 2 3-3 3 3 3-2 2 4" />
      <path d="M4 8v4c0 4 2 8 8 8s8-4 8-8V8" />
      <circle cx="9" cy="12" r="1.5" fill="currentColor" />
      <circle cx="15" cy="12" r="1.5" fill="currentColor" />
      <path d="M10 16h4" />
      <path d="M12 16v2" />
    </svg>
  );
}

export function WolfAvatar({ 
  size = 'md', 
  variant = 'default',
  className,
  animated = false 
}: WolfAvatarProps) {
  const variantClasses = {
    default: 'bg-farm-wolf/20 text-farm-wolf border-farm-wolf/30',
    alpha: 'bg-primary/20 text-primary border-primary/50 shadow-[0_0_15px_hsl(var(--primary)/0.4)]',
    verified: 'bg-farm-gold/20 text-farm-gold border-farm-gold/50 shadow-[0_0_15px_hsl(var(--farm-gold)/0.3)]',
  };

  return (
    <div 
      className={cn(
        'rounded-full border-2 flex items-center justify-center transition-all duration-300',
        sizeClasses[size],
        variantClasses[variant],
        animated && 'hover:animate-wolf-prowl',
        className
      )}
    >
      <WolfIcon size={size} />
    </div>
  );
}

export function WolfBadge({ 
  label, 
  variant = 'default' 
}: { 
  label: string; 
  variant?: 'alpha' | 'sharp' | 'verified' | 'default';
}) {
  const badgeClasses = {
    'alpha': 'bg-primary/20 text-primary border-primary/50',
    'sharp': 'bg-farm-wolf/20 text-farm-wolf border-farm-wolf/50',
    'verified': 'bg-farm-gold/20 text-farm-gold border-farm-gold/50',
    'default': 'bg-farm-wolf/20 text-farm-wolf border-farm-wolf/50',
  };

  return (
    <div className={cn(
      'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border',
      badgeClasses[variant]
    )}>
      <WolfIcon size="sm" />
      <span>{label}</span>
    </div>
  );
}
