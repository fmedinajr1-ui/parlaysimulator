import { cn } from '@/lib/utils';
import { TutorialStep as TutorialStepType } from './tutorialSteps';

interface TutorialStepProps {
  step: TutorialStepType;
  currentIndex: number;
  totalSteps: number;
  onNext: () => void;
  onPrev: () => void;
  onSkip: () => void;
  isFirst: boolean;
  isLast: boolean;
  targetRect?: DOMRect | null;
}

export function TutorialStepComponent({
  step,
  currentIndex,
  totalSteps,
  onNext,
  onPrev,
  onSkip,
  isFirst,
  isLast,
  targetRect,
}: TutorialStepProps) {
  // Calculate tooltip position
  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect || step.position === 'center') {
      return {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
      };
    }

    const padding = 16;
    const tooltipWidth = 300;
    const tooltipHeight = 200;

    let top = 0;
    let left = 0;

    switch (step.position) {
      case 'bottom':
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'top':
        top = targetRect.top - tooltipHeight - padding;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
        break;
      case 'left':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.left - tooltipWidth - padding;
        break;
      case 'right':
        top = targetRect.top + targetRect.height / 2 - tooltipHeight / 2;
        left = targetRect.right + padding;
        break;
      default:
        top = targetRect.bottom + padding;
        left = targetRect.left + targetRect.width / 2 - tooltipWidth / 2;
    }

    // Keep tooltip within viewport
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));
    top = Math.max(padding, Math.min(top, window.innerHeight - tooltipHeight - padding));

    return {
      position: 'fixed',
      top: `${top}px`,
      left: `${left}px`,
      width: `${tooltipWidth}px`,
    };
  };

  return (
    <div
      className={cn(
        "bg-card border border-border rounded-2xl p-5 shadow-2xl z-[10001]",
        "animate-in fade-in-0 zoom-in-95 duration-200"
      )}
      style={getTooltipStyle()}
    >
      {/* Progress dots */}
      <div className="flex justify-center gap-1.5 mb-4">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-2 h-2 rounded-full transition-colors",
              i === currentIndex ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>

      {/* Emoji */}
      {step.emoji && (
        <div className="text-4xl text-center mb-3 emoji-bounce">
          {step.emoji}
        </div>
      )}

      {/* Content */}
      <h3 className="font-display text-xl text-foreground text-center mb-2">
        {step.title}
      </h3>
      <p className="text-sm text-muted-foreground text-center mb-5">
        {step.description}
      </p>

      {/* Actions */}
      <div className="flex gap-2">
        <button
          onClick={onSkip}
          className="flex-1 py-2.5 px-4 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg"
        >
          Skip
        </button>
        
        {!isFirst && (
          <button
            onClick={onPrev}
            className="py-2.5 px-4 text-sm text-muted-foreground hover:text-foreground transition-colors rounded-lg"
          >
            Back
          </button>
        )}
        
        <button
          onClick={onNext}
          className={cn(
            "flex-[2] py-2.5 px-4 text-sm font-medium rounded-lg transition-colors",
            "bg-primary text-primary-foreground hover:bg-primary/90"
          )}
        >
          {isLast ? "Got it!" : "Next"}
        </button>
      </div>
    </div>
  );
}
