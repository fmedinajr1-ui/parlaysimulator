import { cn } from "@/lib/utils";

interface ParlayFarmLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

export function ParlayFarmLogo({ size = 'md', className }: ParlayFarmLogoProps) {
  const sizeClasses = {
    sm: 'h-8',
    md: 'h-12',
    lg: 'h-20',
    xl: 'h-28'
  };

  return (
    <img 
      src="/parlay-farm-logo.png" 
      alt="Parlay Farm" 
      className={cn(sizeClasses[size], 'w-auto', className)}
    />
  );
}
