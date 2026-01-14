import React, { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { 
  Video, 
  VideoOff, 
  Zap, 
  Clock, 
  AlertTriangle, 
  Target,
  Star,
  Play,
  Square,
  Monitor
} from "lucide-react";
import { GameContext, AnalysisResult } from "@/pages/Scout";
import {
  requestScreenCapture,
  stopScreenCapture,
  captureFrame,
  captureFrameBurst,
  playHapticFeedback,
  isScreenCaptureSupported,
  getMomentLabel,
  formatCaptureTime,
} from "@/lib/live-stream-capture";
import { supabase } from "@/integrations/supabase/client";

export interface KeyMoment {
  id: string;
  timestamp: Date;
  type: 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'other';
  label: string;
  frames: string[];
  priority: 'high';
  analyzed: boolean;
  observations?: string[];
}

export interface LiveObservation {
  id: string;
  timestamp: Date;
  gameTime: string;
  type: 'fatigue' | 'energy' | 'mechanics' | 'team';
  playerName: string;
  observation: string;
  confidence: 'low' | 'medium' | 'high';
  fromKeyMoment: boolean;
}

interface ScoutLiveCaptureProps {
  gameContext: GameContext;
  onObservationsUpdate: (observations: LiveObservation[]) => void;
  onHalftimeAnalysis: (result: AnalysisResult, frames: string[]) => void;
}

export function ScoutLiveCapture({ 
  gameContext, 
  onObservationsUpdate,
  onHalftimeAnalysis 
}: ScoutLiveCaptureProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [isMarkingMoment, setIsMarkingMoment] = useState(false);
  const [keyMoments, setKeyMoments] = useState<KeyMoment[]>([]);
  const [observations, setObservations] = useState<LiveObservation[]>([]);
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
  const [autoFrameCount, setAutoFrameCount] = useState(0);
  
  // Auto-capture interval ref
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check browser support
  const isSupported = isScreenCaptureSupported();

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopScreenCapture(mediaStream);
      if (captureIntervalRef.current) {
        clearInterval(captureIntervalRef.current);
      }
    };
  }, [mediaStream]);

  // Update parent when observations change
  useEffect(() => {
    onObservationsUpdate(observations);
  }, [observations, onObservationsUpdate]);

  const startCapture = async () => {
    try {
      const stream = await requestScreenCapture();
      setMediaStream(stream);
      setIsCapturing(true);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }

      // Start auto-capture every 30 seconds
      captureIntervalRef.current = setInterval(() => {
        autoCapture();
      }, 30000);

      toast({
        title: "Live Capture Started",
        description: "AI is now monitoring your stream",
      });

      // Handle stream end (user stops sharing)
      stream.getVideoTracks()[0].onended = () => {
        handleStopCapture();
      };
    } catch (error) {
      toast({
        title: "Capture Failed",
        description: error instanceof Error ? error.message : "Could not start screen capture",
        variant: "destructive",
      });
    }
  };

  const handleStopCapture = () => {
    stopScreenCapture(mediaStream);
    setMediaStream(null);
    setIsCapturing(false);
    
    if (captureIntervalRef.current) {
      clearInterval(captureIntervalRef.current);
      captureIntervalRef.current = null;
    }

    toast({
      title: "Capture Stopped",
      description: `Captured ${keyMoments.length} key moments, ${autoFrameCount} auto frames`,
    });
  };

  const autoCapture = async () => {
    if (!videoRef.current || !isCapturing) return;
    
    try {
      const frame = captureFrame(videoRef.current);
      setAutoFrameCount(prev => prev + 1);
      // Auto frames are queued but not immediately analyzed
      // They'll be used in halftime compilation
    } catch (error) {
      console.error('Auto capture failed:', error);
    }
  };

  const markKeyMoment = async (momentType: 'timeout' | 'injury' | 'fastbreak' | 'freethrow' | 'other') => {
    if (!videoRef.current || !isCapturing) return;

    setIsMarkingMoment(true);
    playHapticFeedback();

    try {
      // Capture 5 frames in rapid succession
      const frames = await captureFrameBurst(videoRef.current, 5, 200);

      const moment: KeyMoment = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type: momentType,
        label: getMomentLabel(momentType),
        frames,
        priority: 'high',
        analyzed: false,
      };

      setKeyMoments(prev => [...prev, moment]);

      toast({
        title: "Key Moment Captured!",
        description: `${moment.label} - 5 frames saved for priority analysis`,
      });

      // Analyze key moment immediately
      analyzeKeyMoment(moment);
    } catch (error) {
      toast({
        title: "Capture Failed",
        description: "Could not capture key moment frames",
        variant: "destructive",
      });
    } finally {
      setIsMarkingMoment(false);
    }
  };

  const analyzeKeyMoment = async (moment: KeyMoment) => {
    try {
      const { data, error } = await supabase.functions.invoke('analyze-live-frame', {
        body: {
          frames: moment.frames,
          gameContext,
          momentType: moment.type,
          isPriority: true,
        },
      });

      if (error) throw error;

      if (data?.observations) {
        const newObservations: LiveObservation[] = data.observations.map((obs: any) => ({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          gameTime: data.gameTime || 'Unknown',
          type: obs.type || 'fatigue',
          playerName: obs.playerName || 'Unknown',
          observation: obs.observation,
          confidence: obs.confidence || 'medium',
          fromKeyMoment: true,
        }));

        setObservations(prev => [...prev, ...newObservations]);
        setKeyMoments(prev => 
          prev.map(m => 
            m.id === moment.id 
              ? { ...m, analyzed: true, observations: data.observations.map((o: any) => o.observation) }
              : m
          )
        );
      }
    } catch (error) {
      console.error('Key moment analysis failed:', error);
      // Don't show error toast for each frame, just log
    }
  };

  const generateHalftimeAnalysis = async () => {
    if (keyMoments.length === 0) {
      toast({
        title: "No Key Moments",
        description: "Mark some key moments first for halftime analysis",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingAnalysis(true);

    try {
      // Collect all key moment frames
      const allFrames = keyMoments.flatMap(m => m.frames);
      
      const { data, error } = await supabase.functions.invoke('analyze-game-footage', {
        body: {
          frames: allFrames,
          gameContext,
          clipCategory: 'halftime-compilation',
          keyMoments: keyMoments.map(m => ({
            type: m.type,
            timestamp: m.timestamp.toISOString(),
            frameCount: m.frames.length,
          })),
        },
      });

      if (error) throw error;

      if (data) {
        onHalftimeAnalysis(data, allFrames);
        toast({
          title: "Halftime Analysis Complete",
          description: `Generated ${data.recommendations?.length || 0} prop recommendations`,
        });
      }
    } catch (error) {
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : "Could not generate halftime analysis",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingAnalysis(false);
    }
  };

  if (!isSupported) {
    return (
      <Card className="border-destructive/50 bg-destructive/5">
        <CardContent className="py-8 text-center">
          <Monitor className="w-12 h-12 mx-auto mb-4 text-destructive/50" />
          <h3 className="font-semibold mb-2">Screen Capture Not Supported</h3>
          <p className="text-sm text-muted-foreground">
            Your browser doesn't support screen capture. Try Chrome, Firefox, or Edge.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Video Preview */}
      <Card className="border-border/50 overflow-hidden">
        <div className="relative aspect-video bg-black">
          <video 
            ref={videoRef} 
            autoPlay 
            muted 
            playsInline
            className="w-full h-full object-contain"
          />
          
          {/* Capture indicator overlay */}
          {isCapturing && (
            <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/50 px-3 py-1.5 rounded-full">
              <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse" />
              <span className="text-white text-sm font-medium">LIVE</span>
            </div>
          )}

          {/* Flash effect when marking moment */}
          {isMarkingMoment && (
            <div className="absolute inset-0 bg-primary/30 animate-pulse pointer-events-none" />
          )}

          {/* Not capturing state */}
          {!isCapturing && (
            <div className="absolute inset-0 flex items-center justify-center bg-muted/50">
              <div className="text-center">
                <Video className="w-12 h-12 mx-auto mb-2 text-muted-foreground" />
                <p className="text-muted-foreground">Share your screen to start</p>
              </div>
            </div>
          )}
        </div>

        {/* Capture Controls */}
        <CardContent className="p-4 space-y-4">
          {/* Start/Stop Button */}
          {!isCapturing ? (
            <Button 
              onClick={startCapture} 
              size="lg" 
              className="w-full h-14"
            >
              <Play className="w-5 h-5 mr-2" />
              Start Watching
            </Button>
          ) : (
            <Button 
              onClick={handleStopCapture} 
              variant="destructive" 
              size="lg" 
              className="w-full h-14"
            >
              <Square className="w-5 h-5 mr-2" />
              Stop Capture
            </Button>
          )}

          {/* Mark Key Moment Button - PROMINENT */}
          {isCapturing && (
            <>
              <Button
                onClick={() => markKeyMoment('other')}
                size="lg"
                variant="neon"
                className="w-full h-16 text-lg font-bold"
                disabled={isMarkingMoment}
              >
                <Zap className="w-6 h-6 mr-2" />
                {isMarkingMoment ? 'CAPTURING...' : 'MARK KEY MOMENT'}
              </Button>

              {/* Quick moment type buttons */}
              <div className="grid grid-cols-4 gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => markKeyMoment('timeout')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <Clock className="w-4 h-4 mb-1" />
                  <span className="text-xs">Timeout</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => markKeyMoment('injury')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <AlertTriangle className="w-4 h-4 mb-1" />
                  <span className="text-xs">Injury</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => markKeyMoment('fastbreak')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <Zap className="w-4 h-4 mb-1" />
                  <span className="text-xs">Fast Break</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => markKeyMoment('freethrow')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <Target className="w-4 h-4 mb-1" />
                  <span className="text-xs">Free Throw</span>
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Key Moments Log */}
      {keyMoments.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Star className="w-4 h-4 text-yellow-500" />
              Marked Moments ({keyMoments.length})
            </CardTitle>
            <CardDescription>
              Priority moments for halftime analysis
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-40">
              <div className="space-y-2">
                {keyMoments.map(moment => (
                  <div 
                    key={moment.id} 
                    className="flex items-center gap-3 p-2 rounded-lg bg-muted/30 border border-border/30"
                  >
                    <Badge 
                      variant={moment.analyzed ? "default" : "secondary"}
                      className="capitalize"
                    >
                      {moment.type}
                    </Badge>
                    <span className="text-sm text-muted-foreground flex-1">
                      {formatCaptureTime(moment.timestamp)}
                    </span>
                    <span className="text-xs text-primary">
                      {moment.frames.length} frames
                    </span>
                    {moment.analyzed && (
                      <Badge variant="outline" className="text-xs bg-green-500/10 text-green-500 border-green-500/20">
                        Analyzed
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Live Observations */}
      {observations.length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Zap className="w-4 h-4 text-primary" />
              Live Observations ({observations.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-48">
              <div className="space-y-2">
                {observations.map(obs => (
                  <div 
                    key={obs.id} 
                    className="p-2 rounded-lg bg-muted/30 border border-border/30"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="outline" className="text-xs capitalize">
                        {obs.type}
                      </Badge>
                      <span className="text-sm font-medium">{obs.playerName}</span>
                      {obs.fromKeyMoment && (
                        <Star className="w-3 h-3 text-yellow-500" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground">{obs.observation}</p>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Generate Halftime Analysis Button */}
      {keyMoments.length > 0 && (
        <Button
          onClick={generateHalftimeAnalysis}
          size="lg"
          className="w-full h-14 bg-gradient-to-r from-primary to-chart-1"
          disabled={isGeneratingAnalysis}
        >
          {isGeneratingAnalysis ? (
            <>
              <div className="w-5 h-5 mr-2 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              Generating Halftime Props...
            </>
          ) : (
            <>
              <Zap className="w-5 h-5 mr-2" />
              Generate Halftime Props ({keyMoments.length} moments)
            </>
          )}
        </Button>
      )}
    </div>
  );
}
