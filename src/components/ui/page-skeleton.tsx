import { Skeleton } from "@/components/ui/skeleton";

interface PageSkeletonProps {
  variant?: 'default' | 'cards' | 'list' | 'dashboard';
}

export function PageSkeleton({ variant = 'default' }: PageSkeletonProps) {
  if (variant === 'cards') {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe animate-fade-in">
        <div className="p-4 space-y-4">
          <Skeleton className="h-12 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
          <div className="grid grid-cols-2 gap-3 mt-6">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-32 rounded-xl" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'list') {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe animate-fade-in">
        <div className="p-4 space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <div className="mt-6 space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (variant === 'dashboard') {
    return (
      <div className="min-h-dvh bg-background pb-nav-safe animate-fade-in">
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-64 rounded-xl" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-dvh bg-background pb-nav-safe animate-fade-in">
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-48 rounded-xl mt-6" />
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </div>
    </div>
  );
}
