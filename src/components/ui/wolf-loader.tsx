import { cn } from "@/lib/utils";
import { ParlayFarmLogo } from "@/components/ParlayFarmLogo";

interface WolfLoaderProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  text?: string;
  className?: string;
}

const sizeMap = {
  sm: 'sm' as const,
  md: 'md' as const,
  lg: 'lg' as const,
  xl: 'xl' as const
};

export function WolfLoader({ size = 'md', text, className }: WolfLoaderProps) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <ParlayFarmLogo 
        size={sizeMap[size]} 
        className="animate-logo-glow"
      />
      {text && (
        <p className="text-sm text-muted-foreground animate-pulse font-medium">
          {text}
        </p>
      )}
    </div>
  );
}

interface FullPageWolfLoaderProps {
  text?: string;
}

export function FullPageWolfLoader({ text = "Loading..." }: FullPageWolfLoaderProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <WolfLoader size="lg" text={text} />
    </div>
  );
}
