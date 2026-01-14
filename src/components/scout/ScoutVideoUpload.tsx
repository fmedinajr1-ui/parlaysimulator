import React, { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  extractFramesFromVideo, 
  validateVideoFile, 
  deduplicateFrames,
  type ExtractionProgress 
} from "@/lib/video-frame-extractor";
import { Upload, Video, AlertCircle, Loader2, CheckCircle, ImageIcon } from "lucide-react";
import type { GameContext, AnalysisResult } from "@/pages/Scout";

interface ScoutVideoUploadProps {
  gameContext: GameContext;
  clipCategory: string;
  onAnalysisComplete: (result: AnalysisResult, frames: string[]) => void;
  isAnalyzing: boolean;
  setIsAnalyzing: (analyzing: boolean) => void;
}

export function ScoutVideoUpload({
  gameContext,
  clipCategory,
  onAnalysisComplete,
  isAnalyzing,
  setIsAnalyzing,
}: ScoutVideoUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewFrames, setPreviewFrames] = useState<string[]>([]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file
    const validation = validateVideoFile(file);
    if (!validation.valid) {
      toast({
        title: "Invalid File",
        description: validation.error,
        variant: "destructive",
      });
      return;
    }

    setUploadedFile(file);
    setPreviewFrames([]);

    // Extract frames for preview
    try {
      setExtractionProgress({
        stage: 'loading',
        currentFrame: 0,
        totalFrames: 0,
        message: 'Loading video...',
      });

      const result = await extractFramesFromVideo(file, setExtractionProgress);
      const uniqueFrames = deduplicateFrames(result.frames);
      
      // Show first 4 frames as preview
      setPreviewFrames(uniqueFrames.slice(0, 4).map(f => f.base64));
      
      setExtractionProgress({
        stage: 'complete',
        currentFrame: uniqueFrames.length,
        totalFrames: uniqueFrames.length,
        message: `Ready to analyze ${uniqueFrames.length} frames`,
      });

      toast({
        title: "Video Ready",
        description: `Extracted ${uniqueFrames.length} unique frames`,
      });
    } catch (err) {
      console.error('Frame extraction error:', err);
      setExtractionProgress({
        stage: 'error',
        currentFrame: 0,
        totalFrames: 0,
        message: err instanceof Error ? err.message : 'Failed to process video',
      });
      toast({
        title: "Extraction Failed",
        description: "Try a shorter clip or screenshot instead",
        variant: "destructive",
      });
    }
  }, [toast]);

  const handleAnalyze = useCallback(async () => {
    if (!uploadedFile || !gameContext) return;

    setIsAnalyzing(true);
    
    try {
      setExtractionProgress({
        stage: 'extracting',
        currentFrame: 0,
        totalFrames: 0,
        message: 'Extracting frames...',
      });

      // Re-extract frames for analysis
      const result = await extractFramesFromVideo(uploadedFile, setExtractionProgress);
      const uniqueFrames = deduplicateFrames(result.frames);
      
      // Build roster context string
      const homeRosterContext = gameContext.homeRoster
        .map(p => `#${p.jersey} ${p.name} (${p.position})`)
        .join(', ');
      const awayRosterContext = gameContext.awayRoster
        .map(p => `#${p.jersey} ${p.name} (${p.position})`)
        .join(', ');

      setExtractionProgress({
        stage: 'analyzing',
        currentFrame: uniqueFrames.length,
        totalFrames: uniqueFrames.length,
        message: 'AI analyzing footage...',
      });

      // Send to edge function
      const { data, error } = await supabase.functions.invoke('analyze-game-footage', {
        body: {
          frames: uniqueFrames.slice(0, 30).map(f => f.base64), // Send up to 30 frames, edge function will select based on strategy
          gameContext: {
            homeTeam: gameContext.homeTeam,
            awayTeam: gameContext.awayTeam,
            homeRoster: homeRosterContext,
            awayRoster: awayRosterContext,
            eventId: gameContext.eventId,
          },
          clipCategory,
        },
      });

      if (error) throw error;

      if (data?.analysis) {
        onAnalysisComplete(data.analysis, uniqueFrames.map(f => f.base64));
      } else {
        throw new Error('No analysis returned');
      }

      setExtractionProgress({
        stage: 'complete',
        currentFrame: uniqueFrames.length,
        totalFrames: uniqueFrames.length,
        message: 'Analysis complete!',
      });

    } catch (err) {
      console.error('Analysis error:', err);
      toast({
        title: "Analysis Failed",
        description: err instanceof Error ? err.message : "Failed to analyze footage",
        variant: "destructive",
      });
      setExtractionProgress({
        stage: 'error',
        currentFrame: 0,
        totalFrames: 0,
        message: 'Analysis failed',
      });
    } finally {
      setIsAnalyzing(false);
    }
  }, [uploadedFile, gameContext, clipCategory, onAnalysisComplete, setIsAnalyzing, toast]);

  const getProgressPercentage = () => {
    if (!extractionProgress) return 0;
    if (extractionProgress.stage === 'loading') return 10;
    if (extractionProgress.stage === 'extracting') {
      return 10 + (extractionProgress.currentFrame / extractionProgress.totalFrames) * 40;
    }
    if (extractionProgress.stage === 'analyzing') return 60;
    if (extractionProgress.stage === 'complete') return 100;
    return 0;
  };

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="w-4 h-4 text-chart-3" />
          Upload Game Footage
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Area */}
        <div
          onClick={() => !isAnalyzing && fileInputRef.current?.click()}
          className={`
            border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
            transition-colors duration-200
            ${isAnalyzing ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}
            ${uploadedFile ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}
          `}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileSelect}
            className="hidden"
            disabled={isAnalyzing}
          />
          
          {uploadedFile ? (
            <div className="space-y-2">
              <Video className="w-10 h-10 mx-auto text-primary" />
              <p className="font-medium">{uploadedFile.name}</p>
              <p className="text-sm text-muted-foreground">
                {(uploadedFile.size / (1024 * 1024)).toFixed(1)} MB
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              <Upload className="w-10 h-10 mx-auto text-muted-foreground/50" />
              <p className="font-medium">Drop video or tap to upload</p>
              <p className="text-sm text-muted-foreground">
                MP4, MOV, WebM • 15-60 seconds • Max 100MB
              </p>
            </div>
          )}
        </div>

        {/* Preview Frames */}
        {previewFrames.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="w-4 h-4" />
              Preview Frames
            </div>
            <div className="grid grid-cols-4 gap-2">
              {previewFrames.map((frame, i) => (
                <div key={i} className="aspect-video rounded overflow-hidden bg-muted">
                  <img 
                    src={frame} 
                    alt={`Frame ${i + 1}`} 
                    className="w-full h-full object-cover"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Progress */}
        {extractionProgress && extractionProgress.stage !== 'complete' && (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{extractionProgress.message}</span>
              {extractionProgress.stage === 'analyzing' && (
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
              )}
            </div>
            <Progress value={getProgressPercentage()} className="h-2" />
          </div>
        )}

        {extractionProgress?.stage === 'error' && (
          <div className="flex items-center gap-2 text-destructive text-sm">
            <AlertCircle className="w-4 h-4" />
            {extractionProgress.message}
          </div>
        )}

        {extractionProgress?.stage === 'complete' && !isAnalyzing && (
          <div className="flex items-center gap-2 text-primary text-sm">
            <CheckCircle className="w-4 h-4" />
            {extractionProgress.message}
          </div>
        )}

        {/* Analyze Button */}
        <Button
          onClick={handleAnalyze}
          disabled={!uploadedFile || isAnalyzing}
          className="w-full"
          size="lg"
        >
          {isAnalyzing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Analyzing Footage...
            </>
          ) : (
            <>
              <Video className="w-4 h-4 mr-2" />
              Analyze for Betting Signals
            </>
          )}
        </Button>

        {/* Tips */}
        <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/50 rounded-lg">
          <p className="font-medium">📹 Recording Tips:</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>Capture player jersey numbers clearly</li>
            <li>Include timeouts, free throws, or fast breaks</li>
            <li>Record during Q1/Q2 for halftime analysis</li>
            <li>Avoid shaky footage for better AI recognition</li>
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
