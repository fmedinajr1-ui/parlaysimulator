import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { HelpCircle, RotateCcw } from 'lucide-react';
import { useHints } from '@/hooks/useHints';

export function TutorialToggle() {
  const { hintsEnabled, toggleHints, resetAllHints, isLoading } = useHints();

  if (isLoading) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
            <HelpCircle className="w-5 h-5 text-primary" />
          </div>
          <div>
            <Label htmlFor="hints-toggle" className="text-sm font-medium">
              Show Helpful Hints
            </Label>
            <p className="text-xs text-muted-foreground">
              Display contextual tips throughout the app
            </p>
          </div>
        </div>
        <Switch
          id="hints-toggle"
          checked={hintsEnabled}
          onCheckedChange={toggleHints}
        />
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={resetAllHints}
        className="w-full"
      >
        <RotateCcw className="w-4 h-4 mr-2" />
        Reset All Hints
      </Button>
    </div>
  );
}
