import { cn } from "@/lib/utils";
import wolfLoaderImage from "@/assets/wolf-loader.png";

interface WolfLoaderProps {
  size?: 'sm' | 'md' | 'lg';
  text?: string;
  className?: string;
}

export function WolfLoader({ size = 'md', text, className }: WolfLoaderProps) {
  const sizeClasses = {
    sm: 'h-12 w-12',
    md: 'h-20 w-20',
    lg: 'h-28 w-28'
  };

  return (
    <div className={cn("flex flex-col items-center justify-center gap-3", className)}>
      <img 
        src={wolfLoaderImage} 
        alt="Loading..." 
        className={cn(
          sizeClasses[size], 
          "animate-pulse drop-shadow-[0_0_15px_hsl(var(--primary)/0.5)]"
        )}
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
