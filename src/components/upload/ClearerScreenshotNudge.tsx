import { Camera, Upload, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface ClearerScreenshotNudgeProps {
  onRetry: () => void;
}

export function ClearerScreenshotNudge({ onRetry }: ClearerScreenshotNudgeProps) {
  return (
    <div className="bg-muted/50 border border-dashed border-border rounded-lg p-4 text-center space-y-3">
      <Camera className="w-8 h-8 mx-auto text-muted-foreground" />
      <div>
        <h3 className="font-medium text-foreground">Couldn't Read Your Slip</h3>
        <p className="text-sm text-muted-foreground mt-1">
          Try uploading a clearer screenshot with the full bet slip visible
        </p>
      </div>
      
      <div className="text-xs text-muted-foreground space-y-1.5 bg-background/50 rounded-md p-3">
        <div className="flex items-center gap-2 justify-center">
          <Lightbulb className="w-3 h-3 text-primary" />
          <span>Make sure all legs and odds are clearly visible</span>
        </div>
        <div className="flex items-center gap-2 justify-center">
          <Lightbulb className="w-3 h-3 text-primary" />
          <span>Avoid cropped or blurry images</span>
        </div>
        <div className="flex items-center gap-2 justify-center">
          <Lightbulb className="w-3 h-3 text-primary" />
          <span>Screenshots work better than screen recordings</span>
        </div>
      </div>
      
      <Button variant="outline" size="sm" onClick={onRetry} className="mt-2">
        <Upload className="w-4 h-4 mr-2" />
        Try Again
      </Button>
    </div>
  );
}
