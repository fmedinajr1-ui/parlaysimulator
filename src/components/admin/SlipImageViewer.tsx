import { useState } from 'react';
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog';
import { Image as ImageIcon, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SlipImageViewerProps {
  imageUrl: string | null | undefined;
  className?: string;
}

export const SlipImageViewer = ({ imageUrl, className }: SlipImageViewerProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [hasError, setHasError] = useState(false);

  if (!imageUrl || hasError) {
    return (
      <div 
        className={cn(
          "w-14 h-14 rounded-lg bg-muted/50 flex items-center justify-center flex-shrink-0",
          className
        )}
      >
        <ImageIcon className="w-5 h-5 text-muted-foreground" />
      </div>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setIsOpen}>
      <DialogTrigger asChild>
        <button
          className={cn(
            "w-14 h-14 rounded-lg overflow-hidden flex-shrink-0 border border-border hover:border-primary/50 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/50",
            className
          )}
        >
          <img
            src={imageUrl}
            alt="Betting slip thumbnail"
            className="w-full h-full object-cover"
            onError={() => setHasError(true)}
          />
        </button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl p-0 overflow-hidden">
        <div className="relative">
          <img
            src={imageUrl}
            alt="Betting slip"
            className="w-full h-auto max-h-[80vh] object-contain"
            onError={() => setHasError(true)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
};
