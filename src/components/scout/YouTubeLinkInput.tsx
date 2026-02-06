import React, { useState, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { 
  Link2, 
  Loader2, 
  CheckCircle, 
  AlertCircle, 
  Youtube, 
  Twitter,
  ImageIcon,
} from "lucide-react";

export interface VideoInfo {
  title: string;
  duration?: number;
  platform: string;
  streamUrl?: string; // Stream URL for client-side frame extraction
}

interface YouTubeLinkInputProps {
  onFramesExtracted: (frames: string[], videoInfo: VideoInfo) => void;
  onError: (error: string) => void;
  isProcessing: boolean;
  setIsProcessing: (processing: boolean) => void;
  disabled?: boolean;
}

// URL pattern validators
const URL_PATTERNS = {
  youtube: [
    /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/,
  ],
  twitter: [
    /(?:twitter\.com|x\.com)\/\w+\/status\/(\d+)/,
  ],
  tiktok: [
    /tiktok\.com\/@[\w.-]+\/video\/(\d+)/,
  ],
};

function detectPlatform(url: string): { platform: string; videoId: string } | null {
  for (const [platform, patterns] of Object.entries(URL_PATTERNS)) {
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) {
        return { platform, videoId: match[1] };
      }
    }
  }
  return null;
}

function validateUrl(url: string): { valid: boolean; error?: string; platform?: string } {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, error: 'Please enter a URL' };
  }
  
  const detected = detectPlatform(url.trim());
  if (!detected) {
    return { 
      valid: false, 
      error: 'Please enter a valid YouTube, Twitter/X, or TikTok link' 
    };
  }
  
  return { valid: true, platform: detected.platform };
}

function getPlatformIcon(platform: string) {
  switch (platform) {
    case 'youtube':
      return <Youtube className="w-4 h-4 text-destructive" />;
    case 'twitter':
      return <Twitter className="w-4 h-4 text-primary" />;
    case 'tiktok':
      return <span className="text-sm">🎵</span>;
    default:
      return <Link2 className="w-4 h-4" />;
  }
}

export function YouTubeLinkInput({
  onFramesExtracted,
  onError,
  isProcessing,
  setIsProcessing,
  disabled = false,
}: YouTubeLinkInputProps) {
  const [url, setUrl] = useState('');
  const [progress, setProgress] = useState(0);
  const [statusMessage, setStatusMessage] = useState('');
  const [previewFrames, setPreviewFrames] = useState<string[]>([]);
  const [extractionComplete, setExtractionComplete] = useState(false);

  const validation = url.trim() ? validateUrl(url) : { valid: false };
  const detected = url.trim() ? detectPlatform(url.trim()) : null;

  const handleExtract = useCallback(async () => {
    if (!validation.valid || isProcessing || disabled) return;

    setIsProcessing(true);
    setProgress(10);
    setStatusMessage('Connecting to video service...');
    setExtractionComplete(false);
    setPreviewFrames([]);

    try {
      setProgress(30);
      setStatusMessage('Extracting video frames...');

      const { data, error } = await supabase.functions.invoke('extract-youtube-frames', {
        body: { videoUrl: url.trim() },
      });

      if (error) {
        throw new Error(error.message || 'Failed to extract frames');
      }

      if (!data?.success) {
        throw new Error(data?.error || 'Extraction failed');
      }

      setProgress(80);
      setStatusMessage('Processing frames...');

      const frames = data.frames || [];
      const videoInfo: VideoInfo = {
        title: data.videoInfo?.title || 'Video',
        platform: detected?.platform || 'unknown',
        streamUrl: data.streamUrl, // Include stream URL for client-side extraction
      };

      // Even if no thumbnail frames, we might have a stream URL
      if (frames.length === 0 && !data.streamUrl) {
        throw new Error('No frames could be extracted. Try a different video.');
      }

      // Show preview of first 4 frames
      setPreviewFrames(frames.slice(0, 4));
      
      setProgress(100);
      setStatusMessage(data.streamUrl 
        ? `Ready for full extraction (stream available)`
        : `Extracted ${frames.length} frames`
      );
      setExtractionComplete(true);

      onFramesExtracted(frames, videoInfo);

    } catch (err) {
      console.error('[YouTubeLinkInput] Extraction error:', err);
      const message = err instanceof Error ? err.message : 'Failed to extract video';
      setStatusMessage('');
      setProgress(0);
      onError(message);
    } finally {
      setIsProcessing(false);
    }
  }, [url, validation.valid, isProcessing, disabled, detected, onFramesExtracted, onError, setIsProcessing]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && validation.valid && !isProcessing) {
      handleExtract();
    }
  };

  const handleClear = () => {
    setUrl('');
    setPreviewFrames([]);
    setProgress(0);
    setStatusMessage('');
    setExtractionComplete(false);
  };

  return (
    <div className="space-y-4">
      {/* URL Input */}
      <div className="space-y-2">
        <div className="relative">
          <Input
            type="url"
            placeholder="Paste YouTube, Twitter/X, or TikTok link..."
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={isProcessing || disabled}
            className={`pr-10 ${
              url.trim() && !validation.valid 
                ? 'border-destructive focus-visible:ring-destructive' 
                : ''
            }`}
          />
          {detected && (
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              {getPlatformIcon(detected.platform)}
            </div>
          )}
        </div>
        
        {url.trim() && !validation.valid && (
          <p className="text-xs text-destructive flex items-center gap-1">
            <AlertCircle className="w-3 h-3" />
            {validation.error}
          </p>
        )}
      </div>

      {/* Platform badges */}
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
      <Badge variant="outline" className="gap-1">
          <Youtube className="w-3 h-3 text-destructive" />
          YouTube
        </Badge>
        <Badge variant="outline" className="gap-1">
          <Twitter className="w-3 h-3 text-primary" />
          Twitter/X
        </Badge>
        <Badge variant="outline" className="gap-1">
          <span>🎵</span>
          TikTok
        </Badge>
      </div>

      {/* Progress */}
      {isProcessing && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">{statusMessage}</span>
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          </div>
          <Progress value={progress} className="h-2" />
        </div>
      )}

      {/* Preview Frames */}
      {previewFrames.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <ImageIcon className="w-4 h-4" />
            Preview Frames
            {extractionComplete && (
              <CheckCircle className="w-4 h-4 text-green-500" />
            )}
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

      {/* Extract Button */}
      <div className="flex gap-2">
        <Button
          onClick={handleExtract}
          disabled={!validation.valid || isProcessing || disabled}
          className="flex-1"
          size="lg"
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              Extracting...
            </>
          ) : (
            <>
              <Link2 className="w-4 h-4 mr-2" />
              Extract Frames
            </>
          )}
        </Button>
        
        {(url || previewFrames.length > 0) && !isProcessing && (
          <Button
            variant="outline"
            onClick={handleClear}
            disabled={disabled}
          >
            Clear
          </Button>
        )}
      </div>

      {/* Tips */}
      <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/50 rounded-lg">
        <p className="font-medium">💡 Tips:</p>
        <ul className="list-disc list-inside space-y-1 ml-2">
          <li>Works with YouTube, Twitter/X, and TikTok links</li>
          <li>Best for highlights and game clips (1-5 min)</li>
          <li>Player must be clearly visible in footage</li>
          <li>Public videos only - private videos won't work</li>
        </ul>
      </div>
    </div>
  );
}
