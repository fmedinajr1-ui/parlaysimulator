import { useState, useRef, useEffect } from 'react';
import { X, Dog } from 'lucide-react';
import { cn } from '@/lib/utils';

interface HintTooltipProps {
  id: string;
  message: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
  onDismiss: () => void;
  className?: string;
}

export function HintTooltip({
  id,
  message,
  position = 'bottom',
  onDismiss,
  className,
}: HintTooltipProps) {
  const [isVisible, setIsVisible] = useState(true);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [translateX, setTranslateX] = useState(0);
  const tooltipRef = useRef<HTMLDivElement>(null);

  const positionClasses = {
    top: 'bottom-full mb-2',
    bottom: 'top-full mt-2',
    left: 'right-full mr-2',
    right: 'left-full ml-2',
  };

  const arrowClasses = {
    top: 'bottom-[-6px] left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-b-transparent border-t-card',
    bottom: 'top-[-6px] left-1/2 -translate-x-1/2 border-l-transparent border-r-transparent border-t-transparent border-b-card',
    left: 'right-[-6px] top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-r-transparent border-l-card',
    right: 'left-[-6px] top-1/2 -translate-y-1/2 border-t-transparent border-b-transparent border-l-transparent border-r-card',
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const currentX = e.touches[0].clientX;
    const diff = currentX - touchStart;
    setTranslateX(diff);
  };

  const handleTouchEnd = () => {
    if (Math.abs(translateX) > 80) {
      handleDismiss();
    } else {
      setTranslateX(0);
    }
    setTouchStart(null);
  };

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(onDismiss, 300);
  };

  if (!isVisible) return null;

  return (
    <div
      ref={tooltipRef}
      className={cn(
        'absolute z-50 transition-all duration-300',
        positionClasses[position],
        isVisible ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
        className
      )}
      style={{ transform: `translateX(${translateX}px)` }}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="bg-card border border-primary/30 rounded-xl p-3 shadow-lg shadow-primary/10 max-w-[250px]">
        <div className="flex items-start gap-2">
          <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center flex-shrink-0">
            <Dog size={16} className="text-primary" />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm text-foreground leading-tight">{message}</p>
            <p className="text-[10px] text-muted-foreground mt-1">Swipe to dismiss</p>
          </div>
          <button
            onClick={handleDismiss}
            className="p-1 rounded-full hover:bg-muted transition-colors flex-shrink-0"
          >
            <X size={14} className="text-muted-foreground" />
          </button>
        </div>
      </div>
      {/* Arrow */}
      <div className={cn(
        'absolute w-0 h-0 border-[6px]',
        arrowClasses[position]
      )} />
    </div>
  );
}
