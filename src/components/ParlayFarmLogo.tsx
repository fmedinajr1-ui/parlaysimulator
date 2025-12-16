import { cn } from "@/lib/utils";

interface ParlayFarmLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
  className?: string;
}

export function ParlayFarmLogo({ size = 'md', className }: ParlayFarmLogoProps) {
  const sizeClasses = {
    sm: 'h-8',
    md: 'h-12',
    lg: 'h-20',
    xl: 'h-28',
    '2xl': 'h-36',
    '3xl': 'h-44'
  };

  return (
    <img 
      src="/parlay-farm-logo.png" 
      alt="Parlay Farm" 
      className={cn(sizeClasses[size], 'w-auto', className)}
    />
  );
}
