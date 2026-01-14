import React, { useState, useRef, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
  Monitor,
  Loader2,
  Activity,
  Camera
} from "lucide-react";
import { GameContext, AnalysisResult } from "@/pages/Scout";
import {
  requestScreenCapture,
  stopScreenCapture,
  captureFrame,
  captureFrameBurst,
  playHapticFeedback,
  isScreenCaptureSupported,
  isCameraSupported,
  getVideoDevices,
  requestCameraCapture,
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
  gameTime?: string; // "Q1 8:42" format
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
  const [capturedFrames, setCapturedFrames] = useState<string[]>([]);
  
  // Game time input state
  const [showGameTimeInput, setShowGameTimeInput] = useState(false);
  const [pendingMomentType, setPendingMomentType] = useState<string | null>(null);
  const [tempCapturedFrames, setTempCapturedFrames] = useState<string[]>([]);
  const [gameTimeQuarter, setGameTimeQuarter] = useState<string>('Q1');
  const [gameTimeMinutes, setGameTimeMinutes] = useState<string>('');
  const [gameTimeSeconds, setGameTimeSeconds] = useState<string>('');
  
  // Capture mode state (screen share vs capture card)
  const [captureMode, setCaptureMode] = useState<'screen' | 'camera'>('screen');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
  // Auto-capture interval ref
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Check browser support
  const isSupported = isScreenCaptureSupported() || isCameraSupported();

  // Load video devices on mount
  useEffect(() => {
    async function loadDevices() {
      const devices = await getVideoDevices();
      setVideoDevices(devices);
      // Auto-select first device if available
      if (devices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(devices[0].deviceId);
      }
    }
    loadDevices();
  }, []);

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
      let stream: MediaStream;
      
      if (captureMode === 'camera') {
        stream = await requestCameraCapture(selectedDeviceId || undefined);
      } else {
        stream = await requestScreenCapture();
      }
      
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
        description: captureMode === 'camera' 
          ? "Capture card connected - AI is now monitoring"
          : "AI is now monitoring your stream",
      });

      // Handle stream end (user stops sharing or disconnects device)
      stream.getVideoTracks()[0].onended = () => {
        handleStopCapture();
      };
    } catch (error) {
      toast({
        title: "Capture Failed",
        description: error instanceof Error ? error.message : "Could not start capture",
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
      setCapturedFrames(prev => [...prev, frame]);
      setAutoFrameCount(prev => prev + 1);
    } catch (error) {
      console.error('Auto capture failed:', error);
    }
  };

  const formatGameTime = (quarter: string, minutes: string, seconds: string): string => {
    const mins = minutes.padStart(2, '0');
    const secs = (seconds || '00').padStart(2, '0');
    return `${quarter} ${mins}:${secs}`;
  };

  const resetGameTimeInput = () => {
    setShowGameTimeInput(false);
    setPendingMomentType(null);
    setTempCapturedFrames([]);
    setGameTimeQuarter('Q1');
    setGameTimeMinutes('');
    setGameTimeSeconds('');
    setIsMarkingMoment(false);
  };

  const startMarkKeyMoment = async (momentType: string) => {
    if (!videoRef.current || !isCapturing) return;
    
    setIsMarkingMoment(true);
    playHapticFeedback();
    
    try {
      // Capture 5 frames immediately (rapid burst)
      const frames = await captureFrameBurst(videoRef.current, 5, 200);
      setTempCapturedFrames(frames);
      setPendingMomentType(momentType);
      setShowGameTimeInput(true);
    } catch (error) {
      console.error('Error capturing frames:', error);
      toast({
        title: "Capture Failed",
        description: "Could not capture key moment frames",
        variant: "destructive",
      });
      setIsMarkingMoment(false);
    }
  };

  const confirmKeyMoment = (gameTime: string | null) => {
    if (!pendingMomentType) return;
    
    const moment: KeyMoment = {
      id: crypto.randomUUID(),
      timestamp: new Date(),
      type: pendingMomentType as KeyMoment['type'],
      label: getMomentLabel(pendingMomentType),
      frames: tempCapturedFrames,
      priority: 'high',
      analyzed: false,
      gameTime: gameTime || undefined,
    };
    
    setKeyMoments(prev => [...prev, moment]);

    toast({
      title: "Key Moment Captured!",
      description: `${moment.label}${gameTime ? ` at ${gameTime}` : ''} - 5 frames saved`,
    });

    analyzeKeyMoment(moment);
    resetGameTimeInput();
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
          gameTime: moment.gameTime || data.gameTime || 'Unknown',
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
    }
  };

  const generateHalftimeAnalysis = async () => {
    if (keyMoments.length === 0 && capturedFrames.length === 0) {
      toast({
        title: "No Data",
        description: "Mark some key moments first for halftime analysis",
        variant: "destructive",
      });
      return;
    }

    setIsGeneratingAnalysis(true);

    try {
      const { data, error } = await supabase.functions.invoke('compile-halftime-analysis', {
        body: {
          gameContext,
          keyMoments: keyMoments.map(m => ({
            type: m.type,
            gameTime: m.gameTime || null,
            timestamp: m.timestamp.toISOString(),
            frames: m.frames,
            observations: m.observations,
          })),
          liveObservations: observations.map(o => ({
            playerName: o.playerName,
            type: o.type,
            observation: o.observation,
            confidence: o.confidence,
            gameTime: o.gameTime,
          })),
          capturedFrames: capturedFrames.slice(-10),
        },
      });

      if (error) throw error;

      if (data) {
        // Collect all frames for the result
        const allFrames = keyMoments.flatMap(m => m.frames);
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
          {/* Capture Mode Toggle */}
          {!isCapturing && (
            <div className="flex gap-2">
              <Button
                variant={captureMode === 'screen' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCaptureMode('screen')}
                className="flex-1"
              >
                <Monitor className="w-4 h-4 mr-2" />
                Screen Share
              </Button>
              <Button
                variant={captureMode === 'camera' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setCaptureMode('camera')}
                className="flex-1"
              >
                <Camera className="w-4 h-4 mr-2" />
                Capture Card
              </Button>
            </div>
          )}

          {/* Device Selector (shown in camera mode when not capturing) */}
          {!isCapturing && captureMode === 'camera' && (
            <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
              <SelectTrigger>
                <SelectValue placeholder="Select capture device" />
              </SelectTrigger>
              <SelectContent>
                {videoDevices.length === 0 ? (
                  <SelectItem value="none" disabled>No devices found</SelectItem>
                ) : (
                  videoDevices.map((device, index) => (
                    <SelectItem key={device.deviceId} value={device.deviceId}>
                      {device.label || `Camera ${index + 1}`}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          )}

          {/* Start/Stop Button */}
          {!isCapturing ? (
            <Button 
              onClick={startCapture} 
              size="lg" 
              className="w-full h-14"
              disabled={captureMode === 'camera' && videoDevices.length === 0}
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

          {/* Mark Key Moment Button with Game Time Input */}
          {isCapturing && (
            <>
              <Popover open={showGameTimeInput} onOpenChange={(open) => {
                if (!open) resetGameTimeInput();
              }}>
                <PopoverTrigger asChild>
                  <Button
                    onClick={() => startMarkKeyMoment('other')}
                    size="lg"
                    variant="neon"
                    className="w-full h-16 text-lg font-bold"
                    disabled={isMarkingMoment && !showGameTimeInput}
                  >
                    {isMarkingMoment && !showGameTimeInput ? (
                      <>
                        <Loader2 className="w-6 h-6 mr-2 animate-spin" />
                        CAPTURING...
                      </>
                    ) : (
                      <>
                        <Zap className="w-6 h-6 mr-2" />
                        MARK KEY MOMENT
                      </>
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-4" align="center">
                  <div className="space-y-4">
                    <h4 className="font-medium text-sm">Add Game Time (optional)</h4>
                    
                    {/* Quarter Select */}
                    <Select value={gameTimeQuarter} onValueChange={setGameTimeQuarter}>
                      <SelectTrigger>
                        <SelectValue placeholder="Quarter" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Q1">Q1</SelectItem>
                        <SelectItem value="Q2">Q2</SelectItem>
                        <SelectItem value="Q3">Q3</SelectItem>
                        <SelectItem value="Q4">Q4</SelectItem>
                        <SelectItem value="OT">OT</SelectItem>
                      </SelectContent>
                    </Select>
                    
                    {/* Time Inputs */}
                    <div className="flex items-center gap-2">
                      <Input 
                        type="number" 
                        placeholder="MM" 
                        value={gameTimeMinutes}
                        onChange={(e) => setGameTimeMinutes(e.target.value.slice(0, 2))}
                        className="w-20 text-center text-lg"
                        min={0} 
                        max={12}
                      />
                      <span className="text-xl font-bold">:</span>
                      <Input 
                        type="number" 
                        placeholder="SS" 
                        value={gameTimeSeconds}
                        onChange={(e) => setGameTimeSeconds(e.target.value.slice(0, 2))}
                        className="w-20 text-center text-lg"
                        min={0} 
                        max={59}
                      />
                    </div>
                    
                    {/* Pending moment type badge */}
                    {pendingMomentType && (
                      <Badge variant="secondary" className="w-full justify-center py-1">
                        {getMomentLabel(pendingMomentType)}
                      </Badge>
                    )}
                    
                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button 
                        variant="ghost" 
                        size="sm" 
                        onClick={() => confirmKeyMoment(null)}
                        className="flex-1"
                      >
                        Skip
                      </Button>
                      <Button 
                        size="sm" 
                        onClick={() => {
                          const gt = gameTimeMinutes 
                            ? formatGameTime(gameTimeQuarter, gameTimeMinutes, gameTimeSeconds)
                            : null;
                          confirmKeyMoment(gt);
                        }}
                        className="flex-1"
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                </PopoverContent>
              </Popover>

              {/* Quick moment type buttons */}
              <div className="grid grid-cols-4 gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => startMarkKeyMoment('timeout')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <Clock className="w-4 h-4 mb-1" />
                  <span className="text-xs">Timeout</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => startMarkKeyMoment('injury')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <AlertTriangle className="w-4 h-4 mb-1" />
                  <span className="text-xs">Injury</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => startMarkKeyMoment('fastbreak')}
                  disabled={isMarkingMoment}
                  className="flex flex-col h-auto py-2"
                >
                  <Zap className="w-4 h-4 mb-1" />
                  <span className="text-xs">Fast Break</span>
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => startMarkKeyMoment('freethrow')}
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
                    className="flex items-center gap-2 p-2 rounded-lg bg-muted/30 border border-border/30"
                  >
                    {moment.gameTime && (
                      <Badge variant="outline" className="text-xs font-mono shrink-0">
                        {moment.gameTime}
                      </Badge>
                    )}
                    <Badge 
                      variant={moment.analyzed ? "default" : "secondary"}
                      className="capitalize shrink-0"
                    >
                      {moment.type}
                    </Badge>
                    {!moment.gameTime && (
                      <span className="text-sm text-muted-foreground">
                        {formatCaptureTime(moment.timestamp)}
                      </span>
                    )}
                    <span className="text-xs text-primary ml-auto flex items-center gap-1 shrink-0">
                      {moment.analyzed ? (
                        <Activity className="w-3 h-3" />
                      ) : (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      )}
                      {moment.frames.length} frames
                    </span>
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
                      {obs.gameTime && obs.gameTime !== 'Unknown' && (
                        <Badge variant="outline" className="text-xs font-mono">
                          {obs.gameTime}
                        </Badge>
                      )}
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
              <Loader2 className="w-5 h-5 mr-2 animate-spin" />
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
