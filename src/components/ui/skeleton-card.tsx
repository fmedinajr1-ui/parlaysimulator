import { cn } from "@/lib/utils";

interface SkeletonCardProps {
  variant?: 'default' | 'bet' | 'stats' | 'compact';
  className?: string;
}

export function SkeletonCard({ variant = 'default', className }: SkeletonCardProps) {
  if (variant === 'bet') {
    return (
      <div className={cn("rounded-xl bg-card border border-border/50 p-4 space-y-4", className)}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-16 h-5 bg-muted rounded-full shimmer" />
            <div className="w-12 h-5 bg-muted rounded-full shimmer" />
          </div>
          <div className="w-20 h-8 bg-muted rounded-lg shimmer" />
        </div>
        
        {/* Legs */}
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border/30 last:border-0">
              <div className="flex-1">
                <div className="w-3/4 h-4 bg-muted rounded shimmer mb-2" />
                <div className="w-1/2 h-3 bg-muted rounded shimmer" />
              </div>
              <div className="w-14 h-6 bg-muted rounded shimmer" />
            </div>
          ))}
        </div>
        
        {/* Footer */}
        <div className="flex items-center justify-between pt-2">
          <div className="w-24 h-8 bg-muted rounded-lg shimmer" />
          <div className="w-32 h-10 bg-muted rounded-lg shimmer" />
        </div>
      </div>
    );
  }

  if (variant === 'stats') {
    return (
      <div className={cn("rounded-xl bg-card border border-border/50 p-4", className)}>
        <div className="grid grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="text-center space-y-2">
              <div className="w-12 h-8 bg-muted rounded mx-auto shimmer" />
              <div className="w-16 h-3 bg-muted rounded mx-auto shimmer" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (variant === 'compact') {
    return (
      <div className={cn("rounded-xl bg-card border border-border/50 p-3 flex items-center gap-3", className)}>
        <div className="w-10 h-10 bg-muted rounded-full shimmer" />
        <div className="flex-1 space-y-2">
          <div className="w-3/4 h-4 bg-muted rounded shimmer" />
          <div className="w-1/2 h-3 bg-muted rounded shimmer" />
        </div>
        <div className="w-16 h-8 bg-muted rounded-lg shimmer" />
      </div>
    );
  }

  return (
    <div className={cn("rounded-xl bg-card border border-border/50 p-4 space-y-4", className)}>
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 bg-muted rounded-full shimmer" />
        <div className="flex-1 space-y-2">
          <div className="w-1/2 h-4 bg-muted rounded shimmer" />
          <div className="w-1/3 h-3 bg-muted rounded shimmer" />
        </div>
      </div>
      <div className="space-y-2">
        <div className="w-full h-4 bg-muted rounded shimmer" />
        <div className="w-5/6 h-4 bg-muted rounded shimmer" />
        <div className="w-2/3 h-4 bg-muted rounded shimmer" />
      </div>
      <div className="flex gap-2 pt-2">
        <div className="w-20 h-8 bg-muted rounded-lg shimmer" />
        <div className="w-20 h-8 bg-muted rounded-lg shimmer" />
      </div>
    </div>
  );
}

interface SkeletonListProps {
  count?: number;
  variant?: 'default' | 'bet' | 'stats' | 'compact';
  className?: string;
}

export function SkeletonList({ count = 3, variant = 'default', className }: SkeletonListProps) {
  return (
    <div className={cn("space-y-3", className)}>
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} variant={variant} />
      ))}
    </div>
  );
}
