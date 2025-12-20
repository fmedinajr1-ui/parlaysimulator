import { useState, useRef, useCallback } from 'react';
import { FeedCard } from '@/components/FeedCard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Upload, Pencil, History, X, Loader2, Plus, Trash2, Crown, Video } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/contexts/AuthContext';
import { PaywallModal } from '@/components/PaywallModal';
import { compressImage, validateImageFile } from '@/lib/image-compression';
import { extractFramesFromVideo, isVideoFile, validateVideoFile, type ExtractionProgress } from '@/lib/video-frame-extractor';

export interface LegInput {
  id: string;
  description: string;
  odds: string;
}

interface ParlaySlotProps {
  index: number;
  legs: LegInput[];
  stake: string;
  extractedTotalOdds: number | null;
  status: 'empty' | 'filled' | 'processing';
  onUpdate: (legs: LegInput[], stake: string, extractedTotalOdds: number | null) => void;
  onClear: () => void;
  onSelectFromHistory: () => void;
  canRemove: boolean;
  showTutorialAttributes?: boolean;
}

export function ParlaySlot({
  index,
  legs,
  stake,
  extractedTotalOdds,
  status,
  onUpdate,
  onClear,
  onSelectFromHistory,
  canRemove,
  showTutorialAttributes = false,
}: ParlaySlotProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [inputMode, setInputMode] = useState<'select' | 'manual' | null>(status === 'filled' ? 'manual' : null);
  const [showPaywall, setShowPaywall] = useState(false);
  const [videoProgress, setVideoProgress] = useState<ExtractionProgress | null>(null);
  
  const { user } = useAuth();
  const { isSubscribed, isAdmin, canScan, scansRemaining, incrementScan, startCheckout } = useSubscription();

  const processExtractedData = useCallback((data: any) => {
    const extractedLegs = data?.legs || [];
    const extractedTotalOddsStr = data?.totalOdds;
    const extractedStake = data?.stake;

    if (extractedLegs.length === 0) {
      toast({
        title: "No legs found 🤔",
        description: "Try a clearer image or enter manually.",
        variant: "destructive",
      });
      return false;
    }

    const newLegs: LegInput[] = extractedLegs.map((leg: { description: string; odds: string }) => ({
      id: crypto.randomUUID(),
      description: leg.description || "",
      odds: leg.odds?.replace('+', '') || "",
    }));

    while (newLegs.length < 2) {
      newLegs.push({ id: crypto.randomUUID(), description: "", odds: "" });
    }

    let parsedOdds: number | null = null;
    if (extractedTotalOddsStr) {
      const parsed = parseInt(extractedTotalOddsStr.replace('+', ''));
      if (!isNaN(parsed) && parsed !== 0) {
        parsedOdds = parsed;
      }
    }

    let newStake = stake;
    if (extractedStake !== null && extractedStake !== undefined) {
      const stakeNum = typeof extractedStake === 'number' ? extractedStake : parseFloat(String(extractedStake).replace(/[$,]/g, ''));
      if (!isNaN(stakeNum) && stakeNum > 0) {
        newStake = stakeNum.toString();
      }
    }

    onUpdate(newLegs, newStake, parsedOdds);
    setInputMode('manual');

    toast({
      title: `Parlay ${index + 1}: Found ${extractedLegs.length} legs! 🎯`,
      description: "Review and edit if needed.",
    });

    return true;
  }, [index, stake, onUpdate]);

  const handleFileSelect = useCallback(async (file: File) => {
    // Check scan access for logged-in users
    if (user && !canScan && !isSubscribed && !isAdmin) {
      setShowPaywall(true);
      return;
    }

    // Handle video files
    if (isVideoFile(file)) {
      const validation = validateVideoFile(file);
      if (!validation.valid) {
        toast({
          title: "Invalid video! 📹",
          description: validation.error,
          variant: "destructive",
        });
        return;
      }

      setIsProcessing(true);
      setVideoProgress({ stage: 'loading', currentFrame: 0, totalFrames: 0, message: 'Loading video...' });

      try {
        const { frames } = await extractFramesFromVideo(file, setVideoProgress);

        if (frames.length === 0) {
          throw new Error("Could not extract frames from video");
        }

        setVideoProgress({
          stage: 'extracting',
          currentFrame: 0,
          totalFrames: frames.length,
          message: 'Analyzing frames with AI...'
        });

        const { data, error } = await supabase.functions.invoke('extract-parlay', {
          body: { frames: frames.map(f => f.base64) }
        });

        if (error || data?.error) {
          throw new Error(error?.message || data?.error || 'Failed to process video');
        }

        const success = processExtractedData(data);

        if (success && user && !isSubscribed && !isAdmin) {
          await incrementScan();
        }

      } catch (error) {
        console.error('Video processing error:', error);
        toast({
          title: "Video scan failed 😵",
          description: error instanceof Error ? error.message : "Try again or use an image.",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
        setVideoProgress(null);
      }
      return;
    }

    // Handle image files
    const validation = validateImageFile(file);
    if (!validation.valid) {
      toast({
        title: "Invalid file! 📁",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);

    try {
      const { base64: imageBase64 } = await compressImage(file);
      const { data, error } = await supabase.functions.invoke('extract-parlay', {
        body: { imageBase64 }
      });

      if (error || data?.error) {
        throw new Error(error?.message || data?.error || 'Failed to process image');
      }

      const success = processExtractedData(data);

      if (success && user && !isSubscribed && !isAdmin) {
        await incrementScan();
      }

    } catch (error) {
      console.error('OCR error:', error);
      toast({
        title: "Scan failed 😵",
        description: error instanceof Error ? error.message : "Try again or enter manually.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, [index, stake, onUpdate, user, canScan, isSubscribed, isAdmin, incrementScan, processExtractedData]);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileSelect(file);
    e.target.value = '';
  }, [handleFileSelect]);

  const triggerFileInput = useCallback(() => {
    // Check scan access before opening file picker
    if (user && !canScan && !isSubscribed && !isAdmin) {
      setShowPaywall(true);
      return;
    }
    fileInputRef.current?.click();
  }, [user, canScan, isSubscribed, isAdmin]);

  const addLeg = () => {
    if (legs.length >= 15) {
      toast({
        title: "Max 15 legs!",
        description: "That's plenty degen for one parlay.",
        variant: "destructive",
      });
      return;
    }
    onUpdate([...legs, { id: crypto.randomUUID(), description: "", odds: "" }], stake, extractedTotalOdds);
  };

  const removeLeg = (id: string) => {
    if (legs.length <= 2) {
      toast({
        title: "Need at least 2 legs!",
        description: "It's not a parlay with just one leg.",
      });
      return;
    }
    onUpdate(legs.filter(l => l.id !== id), stake, extractedTotalOdds);
  };

  const updateLeg = (id: string, field: 'description' | 'odds', value: string) => {
    const newLegs = legs.map(l => l.id === id ? { ...l, [field]: value } : l);
    const newOdds = field === 'odds' ? null : extractedTotalOdds;
    onUpdate(newLegs, stake, newOdds);
  };

  const handleStartManual = () => {
    onUpdate(
      [
        { id: crypto.randomUUID(), description: "", odds: "" },
        { id: crypto.randomUUID(), description: "", odds: "" },
      ],
      "10",
      null
    );
    setInputMode('manual');
  };

  const handleClear = () => {
    setInputMode(null);
    onClear();
  };

  if (isProcessing) {
    return (
      <FeedCard className="p-4">
        <div className="flex flex-col items-center justify-center gap-3 py-8">
          <Loader2 className="w-6 h-6 animate-spin text-primary" />
          {videoProgress ? (
            <>
              <span className="text-muted-foreground text-sm">{videoProgress.message}</span>
              {videoProgress.totalFrames > 0 && (
                <Progress 
                  value={(videoProgress.currentFrame / videoProgress.totalFrames) * 100} 
                  className="w-32 h-2" 
                />
              )}
            </>
          ) : (
            <span className="text-muted-foreground">Scanning parlay {index + 1}...</span>
          )}
        </div>
      </FeedCard>
    );
  }

  // Empty state - show input options
  if (inputMode === null) {
    return (
      <>
        <PaywallModal
          isOpen={showPaywall}
          onClose={() => setShowPaywall(false)}
          onSubscribe={startCheckout}
          scansUsed={3 - scansRemaining}
        />
        
        <FeedCard className="p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v,.mov,.mp4,.webm,.m4v"
          onChange={handleFileInputChange}
          className="hidden"
        />
          
          <div className="text-center mb-4">
            <div className="flex items-center justify-center gap-2 mb-2">
              <Badge variant="outline">Parlay {index + 1}</Badge>
              {user && !isSubscribed && !isAdmin && (
                <Badge 
                  variant="outline" 
                  className={cn(
                    "text-[10px]",
                    scansRemaining === 0 && "border-destructive/50 text-destructive"
                  )}
                >
                  {scansRemaining}/3 scans
                </Badge>
              )}
              {(isSubscribed || isAdmin) && (
                <Badge className="bg-primary/20 text-primary border-primary/30 text-[10px] gap-0.5">
                  <Crown className="w-2.5 h-2.5" />
                  {isAdmin ? 'Admin' : 'Pro'}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">Choose how to add this parlay</p>
          </div>

          <div className="grid grid-cols-1 gap-2">
            <Button
              variant="outline"
              className="h-auto py-3 justify-start gap-3 touch-target-lg"
              onClick={triggerFileInput}
              data-tutorial={showTutorialAttributes ? "upload-button" : undefined}
            >
              <div className="flex gap-1">
                <Upload className="w-5 h-5 text-primary" />
                <Video className="w-4 h-4 text-primary/60" />
              </div>
              <div className="text-left">
                <div className="font-medium">Upload Slip</div>
                <div className="text-xs text-muted-foreground">Image or screen recording</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 justify-start gap-3 touch-target-lg"
              onClick={handleStartManual}
              data-tutorial={showTutorialAttributes ? "manual-button" : undefined}
            >
              <Pencil className="w-5 h-5 text-primary" />
              <div className="text-left">
                <div className="font-medium">Manual Entry</div>
                <div className="text-xs text-muted-foreground">Type in your legs</div>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-auto py-3 justify-start gap-3 touch-target-lg"
              onClick={onSelectFromHistory}
              data-tutorial={showTutorialAttributes ? "history-button" : undefined}
            >
              <History className="w-5 h-5 text-primary" />
              <div className="text-left">
                <div className="font-medium">From History</div>
                <div className="text-xs text-muted-foreground">Use a saved parlay</div>
              </div>
            </Button>
          </div>
        </FeedCard>
      </>
    );
  }

  // Filled state - show legs
  return (
    <>
      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={startCheckout}
        scansUsed={3 - scansRemaining}
      />
      
      <FeedCard className="p-4">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/quicktime,video/webm,video/x-m4v,.mov,.mp4,.webm,.m4v"
          onChange={handleFileInputChange}
          className="hidden"
        />
        
        <div className="flex items-center justify-between mb-3">
          <Badge variant="secondary">Parlay {index + 1}</Badge>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={triggerFileInput}
              className="h-8 w-8 p-0"
            >
              <Upload className="w-4 h-4" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleClear}
              className="h-8 w-8 p-0 text-destructive hover:text-destructive"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {extractedTotalOdds && (
          <div className="bg-primary/10 border border-primary/30 rounded-lg p-2 mb-3 flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Total Odds:</span>
            <span className="font-bold text-primary">
              {extractedTotalOdds > 0 ? '+' : ''}{extractedTotalOdds}
            </span>
          </div>
        )}

        <div className="space-y-2 mb-3">
          {legs.map((leg, legIndex) => (
            <div key={leg.id} className="flex gap-2 items-start">
              <div className="flex-1 space-y-1">
                <Input
                  placeholder={`Leg ${legIndex + 1} description`}
                  value={leg.description}
                  onChange={(e) => updateLeg(leg.id, 'description', e.target.value)}
                  className="h-9 text-sm"
                />
                <Input
                  placeholder="Odds (e.g. -110)"
                  value={leg.odds}
                  onChange={(e) => updateLeg(leg.id, 'odds', e.target.value)}
                  className="h-9 text-sm w-28"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => removeLeg(leg.id)}
                className="h-9 w-9 p-0 text-muted-foreground hover:text-destructive"
                disabled={legs.length <= 2}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>

        <Button
          variant="ghost"
          size="sm"
          onClick={addLeg}
          className="w-full mb-3"
          disabled={legs.length >= 15}
        >
          <Plus className="w-4 h-4 mr-1" />
          Add Leg
        </Button>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Stake: $</span>
          <Input
            type="number"
            value={stake}
            onChange={(e) => onUpdate(legs, e.target.value, extractedTotalOdds)}
            className="h-9 w-24"
            min="0"
          />
        </div>
      </FeedCard>
    </>
  );
}
