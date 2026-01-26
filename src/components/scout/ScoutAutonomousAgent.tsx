import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { SelectGroup, SelectLabel } from '@/components/ui/select';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { useScoutAgentState } from '@/hooks/useScoutAgentState';
import { PlayerStateCard } from './PlayerStateCard';
import { HalftimeBettingPanel } from './HalftimeBettingPanel';
import { GameBetsTab } from './GameBetsTab';
import { PaceMeter } from './PaceMeter';
import { GameContext } from '@/pages/Scout';
import { supabase } from '@/integrations/supabase/client';
import {
  requestScreenCapture,
  stopScreenCapture,
  captureFrame,
  isScreenCaptureSupported,
  isCameraSupported,
  getVideoDevices,
  requestCameraCapture,
  ClassifiedVideoDevice,
} from '@/lib/live-stream-capture';
import {
  Bot,
  Play,
  Square,
  Pause,
  Settings,
  Activity,
  Users,
  Zap,
  Monitor,
  Camera,
  AlertTriangle,
  RefreshCw,
  Save,
  ChevronDown,
  Target,
  TrendingUp,
  Clock,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

interface ScoutAutonomousAgentProps {
  gameContext: GameContext;
}

export function ScoutAutonomousAgent({ gameContext }: ScoutAutonomousAgentProps) {
  const { toast } = useToast();
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pbpIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  
  // Capture mode state
  const [captureMode, setCaptureMode] = useState<'screen' | 'camera'>('screen');
  const [videoDevices, setVideoDevices] = useState<ClassifiedVideoDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  const [showAllDevices, setShowAllDevices] = useState(false);
  
  // Data-only mode (no video required)
  const [dataOnlyMode, setDataOnlyMode] = useState(false);
  
  // Function to refresh device list
  const refreshDevices = async () => {
    const devices = await getVideoDevices();
    setVideoDevices(devices);
    toast({
      title: "Devices Refreshed",
      description: `Found ${devices.length} video device(s)`,
    });
  };
  
  const {
    state,
    startAgent,
    stopAgent,
    pauseAgent,
    resumeAgent,
    setCaptureRate,
    updatePBPData,
    processAgentResponse,
    getTopEdges,
    getFatiguedPlayers,
    getStateForAPI,
    sessionRestored,
    clearSession,
    // V5: Game Bets
    homeTeamState,
    awayTeamState,
    gameBetEdges,
    // V6: PBP Freshness
    lastPbpUpdate,
    lastPbpGameTime,
    refreshPBPData,
  } = useScoutAgentState({ gameContext });
  
  // Tab state for main content
  const [activeScoutTab, setActiveScoutTab] = useState<'bets' | 'props' | 'advanced'>('bets');
  
  // Manual refresh state
  const [isRefreshing, setIsRefreshing] = useState(false);

  const isSupported = isScreenCaptureSupported() || isCameraSupported();

  // Load video devices on mount
  useEffect(() => {
    async function loadDevices() {
      const devices = await getVideoDevices();
      setVideoDevices(devices);
      
      // Auto-select first capture card, or first device if none
      if (devices.length > 0 && !selectedDeviceId) {
        const captureCard = devices.find(d => d.type === 'capture_card');
        setSelectedDeviceId(captureCard?.device.deviceId || devices[0].device.deviceId);
      }
    }
    loadDevices();
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
      if (pbpIntervalRef.current) clearInterval(pbpIntervalRef.current);
      stopScreenCapture(mediaStream);
    };
  }, [mediaStream]);

  // Stop agent when game changes
  useEffect(() => {
    // Clean up when game context changes
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    if (pbpIntervalRef.current) clearInterval(pbpIntervalRef.current);
    if (mediaStream) {
      stopScreenCapture(mediaStream);
      setMediaStream(null);
    }
    stopAgent();
  }, [gameContext.eventId]);

  // Lock to prevent concurrent agent loop calls
  const isRunningLoopRef = useRef(false);

  // Main capture loop
  useEffect(() => {
    if (state.isRunning && !state.isPaused && mediaStream && videoRef.current) {
      const intervalMs = Math.round(1000 / state.captureRate);
      
      captureIntervalRef.current = setInterval(() => {
        // Skip if a call is already in progress
        if (isRunningLoopRef.current) {
          console.log('[Autopilot] Skipping - previous call still in progress');
          return;
        }
        runAgentLoop();
      }, intervalMs);
      
      return () => {
        if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
      };
    }
  }, [state.isRunning, state.isPaused, state.captureRate, mediaStream]);

  // PBP polling loop
  useEffect(() => {
    if (state.isRunning && gameContext.eventId) {
      // Fetch PBP every 10 seconds
      pbpIntervalRef.current = setInterval(() => {
        fetchPBPData();
      }, 10000);
      
      // Initial fetch
      fetchPBPData();
      
      return () => {
        if (pbpIntervalRef.current) clearInterval(pbpIntervalRef.current);
      };
    }
  }, [state.isRunning, gameContext.eventId]);
  
  // Data projection loop - ALWAYS runs as backup/complement to vision
  const dataProjectionIntervalRef = useRef<NodeJS.Timeout | null>(null);
  
  useEffect(() => {
    // Data projections run whenever agent is running, regardless of video/dataOnlyMode
    if (state.isRunning && gameContext.eventId) {
      console.log('[Autopilot] Data projection loop starting (runs alongside vision)');
      
      dataProjectionIntervalRef.current = setInterval(async () => {
        await runDataOnlyProjection();
      }, 15000);
      
      // Initial run after short delay to let PBP data load
      setTimeout(() => runDataOnlyProjection(), 3000);
      
      return () => {
        if (dataProjectionIntervalRef.current) clearInterval(dataProjectionIntervalRef.current);
      };
    }
  }, [state.isRunning, gameContext.eventId]);
  
  const runDataOnlyProjection = async () => {
    if (!state.isRunning || !state.pbpData) return;
    
    try {
      const { data, error } = await supabase.functions.invoke('scout-data-projection', {
        body: {
          playerStates: getStateForAPI(),
          pbpData: state.pbpData,
          propLines: state.gameContext?.propLines,
          gameContext: {
            eventId: gameContext.eventId,
            homeTeam: gameContext.homeTeam,
            awayTeam: gameContext.awayTeam,
          },
        },
      });
      
      if (!error && data) {
        // Process the prop edges
        if (data.propEdges && data.propEdges.length > 0) {
          processAgentResponse({
            sceneClassification: {
              sceneType: 'live_play',
              isAnalysisWorthy: true,
              confidence: 'high',
              gameTime: data.gameTime,
              score: state.currentScore,
              reason: 'Data-only projection',
              timestamp: new Date(),
            },
            propEdges: data.propEdges,
            gameTime: data.gameTime,
          });
        }
        
        // Handle auto-suggest recommendations
        if (data.autoSuggestRecommendations && data.autoSuggestRecommendations.length > 0) {
          console.log('[Autopilot] Auto-suggest recommendations:', data.autoSuggestRecommendations.length);
          
          // Show toast for top recommendation
          const topRec = data.autoSuggestRecommendations[0];
          toast({
            title: `🎯 Auto-Suggest: ${topRec.player}`,
            description: `${topRec.prop} ${topRec.lean} ${topRec.line} | ${topRec.confidence}% conf`,
          });
        }
      }
    } catch (error) {
      console.error('[Autopilot] Data projection error:', error);
    }
  };

  const fetchPBPData = async () => {
    try {
      // Prefer ESPN event ID if available for accurate PBP data
      const eventIdToUse = gameContext.espnEventId || gameContext.eventId;
      console.log(`[Autopilot] Fetching PBP for event: ${eventIdToUse} (ESPN: ${!!gameContext.espnEventId})`);
      
      const { data, error } = await supabase.functions.invoke('fetch-live-pbp', {
        body: { eventId: eventIdToUse },
      });
      
      if (!error && data && !data.notAvailable) {
        updatePBPData(data);
      } else if (data?.notAvailable) {
        console.warn('[Autopilot] PBP not available:', data.reason);
      }
    } catch (error) {
      console.error('[Autopilot] PBP fetch error:', error);
    }
  };

  const runAgentLoop = async (retryCount = 0) => {
    if (!videoRef.current || !state.isRunning || state.isPaused) return;
    
    // Set lock at start of call
    isRunningLoopRef.current = true;
    
    try {
      const frame = captureFrame(videoRef.current, 0.7); // Lower quality for speed
      
      // Validate frame before sending - avoid "Unexpected end of JSON input" errors
      if (!frame || frame.length < 100 || !frame.startsWith('data:image')) {
        console.warn('[Autopilot] Invalid frame captured, skipping');
        isRunningLoopRef.current = false;
        return;
      }
      
      const { data, error } = await supabase.functions.invoke('scout-agent-loop', {
        body: {
          frame,
          gameContext: state.gameContext,
          playerStates: getStateForAPI(),
          pbpData: state.pbpData,
          existingEdges: state.activePropEdges,
          currentGameTime: state.currentGameTime,
          propLines: state.gameContext?.propLines, // Pass real betting lines
        },
      });
      
      // Handle transient errors with retry - check multiple locations for retryAfter
      // Supabase SDK can put 503 response in different places depending on how it fails
      let retryAfter: number | undefined;
      
      // Check in successful data response
      if (data?.retryAfter) {
        retryAfter = data.retryAfter;
      }
      
      // Check in error.context (Supabase SDK v2 pattern)
      if (!retryAfter && (error as any)?.context?.retryAfter) {
        retryAfter = (error as any).context.retryAfter;
      }
      
      // Check if error message is JSON containing retryAfter
      if (!retryAfter && error?.message) {
        try {
          // Try parsing the raw error message as JSON
          const parsed = JSON.parse(error.message);
          if (parsed?.retryAfter) retryAfter = parsed.retryAfter;
        } catch {
          // Check if error message contains the JSON string after a prefix
          const jsonMatch = error.message.match(/\{.*"retryAfter":\s*(\d+).*\}/);
          if (jsonMatch) {
            try {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed?.retryAfter) retryAfter = parsed.retryAfter;
            } catch { /* ignore */ }
          }
        }
      }
      
      // Also check error.body for edge function responses
      if (!retryAfter && (error as any)?.body?.retryAfter) {
        retryAfter = (error as any).body.retryAfter;
      }
      
      if (retryAfter && retryCount < 3) {
        console.log(`[Autopilot] Transient error, retrying in ${retryAfter}ms (attempt ${retryCount + 1}/3)...`);
        // Keep lock held during retry wait, then release after retry completes
        setTimeout(() => {
          runAgentLoop(retryCount + 1).finally(() => {
            isRunningLoopRef.current = false;
          });
        }, retryAfter);
        return; // Don't release lock yet - retry will release it
      }
      
      
      if (!error && data) {
        // Process response even if it has warnings
        processAgentResponse(data);
        
        // Show notification if warranted
        if (data.shouldNotify && data.notification) {
          toast({
            title: `🎯 ${data.notification.player}`,
            description: `${data.notification.prop} ${data.notification.lean} | ${data.notification.confidence}% | ${data.notification.reason}`,
          });
        }
      }
    } catch (error) {
      // Only log, don't show toast for transient errors
      console.error('[Autopilot] Agent loop error:', error);
    } finally {
      // Release lock unless we're waiting for a retry
      if (retryCount === 0) {
        isRunningLoopRef.current = false;
      }
    }
  };

  const handleStart = async () => {
    // Data-only mode: start without video capture
    if (dataOnlyMode) {
      startAgent();
      toast({ 
        title: "Data-Only Mode", 
        description: "Running projections from box score data (no video)" 
      });
      return;
    }
    
    // Normal mode: requires video capture
    try {
      let stream: MediaStream;
      
      if (captureMode === 'camera') {
        stream = await requestCameraCapture(selectedDeviceId || undefined);
      } else {
        stream = await requestScreenCapture();
      }
      
      setMediaStream(stream);
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      
      startAgent();
      
      stream.getVideoTracks()[0].onended = () => {
        handleStop();
      };
    } catch (error) {
      toast({
        title: "Capture Failed",
        description: error instanceof Error ? error.message : "Could not start capture",
        variant: "destructive",
      });
    }
  };

  const handleStop = () => {
    stopScreenCapture(mediaStream);
    setMediaStream(null);
    if (captureIntervalRef.current) clearInterval(captureIntervalRef.current);
    if (pbpIntervalRef.current) clearInterval(pbpIntervalRef.current);
    stopAgent();
  };
  
  // Manual refresh handler
  const handleRefreshStats = async () => {
    setIsRefreshing(true);
    try {
      const result = await refreshPBPData();
      if (result.success) {
        toast({
          title: "Stats Refreshed",
          description: `Updated ${result.playerCount} players`,
        });
      } else {
        toast({
          title: "Refresh Failed",
          description: result.reason,
          variant: "destructive",
        });
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  const topEdges = getTopEdges(5);
  const fatiguedPlayers = getFatiguedPlayers(30); // Lowered threshold
  const allPlayers = Array.from(state.playerStates.values());
  const onCourtPlayers = allPlayers.filter(p => p.onCourt || p.minutesEstimate > 0);

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
      {/* Control Header */}
      <Card className="border-primary/30 bg-primary/5">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bot className={cn(
                "w-6 h-6",
                state.isRunning ? "text-chart-2 animate-pulse" : "text-muted-foreground"
              )} />
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  Scout Autopilot
                  {sessionRestored && (
                    <Badge variant="secondary" className="text-xs">
                      Resumed
                    </Badge>
                  )}
                </CardTitle>
                <CardDescription className="flex items-center gap-2 flex-wrap">
                  {state.isRunning 
                    ? (
                      <>
                        <span>Monitoring at {state.captureRate} FPS</span>
                        {state.analysisCount > 0 && (
                          <span className="flex items-center gap-1 text-chart-2">
                            <Save className="w-3 h-3" />
                            Auto-saving
                          </span>
                        )}
                      </>
                    )
                    : 'Autonomous game monitoring'}
                  {/* Always show timestamp if available */}
                  {lastPbpUpdate && (
                    <span className="flex items-center gap-1 text-muted-foreground text-xs border-l border-border pl-2">
                      <Clock className="w-3 h-3" />
                      Stats: {formatDistanceToNow(lastPbpUpdate, { addSuffix: true })}
                      {lastPbpGameTime && ` (${lastPbpGameTime})`}
                    </span>
                  )}
                </CardDescription>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
              {/* Always visible Refresh Stats button */}
              <Button
                variant="ghost"
                size="sm"
                onClick={handleRefreshStats}
                disabled={isRefreshing || !gameContext.eventId}
                title="Refresh box score stats"
              >
                <RefreshCw className={cn("w-4 h-4", isRefreshing && "animate-spin")} />
              </Button>
              
              {state.isRunning ? (
                <>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => state.isPaused ? resumeAgent() : pauseAgent()}
                  >
                    {state.isPaused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                  </Button>
                  <Button 
                    variant="destructive" 
                    size="sm"
                    onClick={handleStop}
                  >
                    <Square className="w-4 h-4 mr-1" />
                    Stop
                  </Button>
                </>
              ) : (
                <>
                  <Button 
                    onClick={handleStart} 
                    className="gap-2"
                    disabled={captureMode === 'camera' && videoDevices.length === 0}
                  >
                    <Play className="w-4 h-4" />
                    Start Autopilot
                  </Button>
                  {sessionRestored && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={clearSession}
                      title="Clear session and restart fresh"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  )}
                </>
              )}
              <Button 
                variant="ghost" 
                size="icon"
                onClick={() => setShowSettings(!showSettings)}
              >
                <Settings className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* Settings Panel */}
        {showSettings && (
          <CardContent className="pt-0 border-t space-y-3">
            {/* Capture Mode Toggle */}
            {!state.isRunning && (
              <div className="flex gap-2 pt-3">
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

            {/* Device Selector (camera mode) */}
            {!state.isRunning && captureMode === 'camera' && (() => {
              const captureCards = videoDevices.filter(d => d.type === 'capture_card');
              const otherDevices = videoDevices.filter(d => d.type !== 'capture_card');
              const unknownDevices = videoDevices.filter(d => d.type === 'unknown');
              
              return (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Select value={selectedDeviceId} onValueChange={setSelectedDeviceId}>
                      <SelectTrigger className="flex-1">
                        <SelectValue placeholder="Select capture device" />
                      </SelectTrigger>
                      <SelectContent className="bg-popover">
                        {videoDevices.length === 0 ? (
                          <SelectItem value="none" disabled>
                            No devices found - connect a capture card
                          </SelectItem>
                        ) : (
                          <>
                            {/* Capture Cards group */}
                            {captureCards.length > 0 && (
                              <SelectGroup>
                                <SelectLabel className="flex items-center gap-2 text-xs text-muted-foreground">
                                  <Camera className="w-3 h-3" />
                                  Capture Cards
                                </SelectLabel>
                                {captureCards.map((d) => (
                                  <SelectItem key={d.device.deviceId} value={d.device.deviceId}>
                                    {d.displayName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            
                            {/* Other Cameras group */}
                            {otherDevices.filter(d => d.type !== 'unknown').length > 0 && (
                              <SelectGroup>
                                <SelectLabel className="text-xs text-muted-foreground">
                                  Other Cameras
                                </SelectLabel>
                                {otherDevices.filter(d => d.type !== 'unknown').map((d) => (
                                  <SelectItem key={d.device.deviceId} value={d.device.deviceId}>
                                    {d.displayName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                            
                            {/* Unknown devices (shown when toggled) */}
                            {showAllDevices && unknownDevices.length > 0 && (
                              <SelectGroup>
                                <SelectLabel className="text-xs text-muted-foreground">
                                  Unclassified Devices
                                </SelectLabel>
                                {unknownDevices.map((d) => (
                                  <SelectItem key={d.device.deviceId} value={d.device.deviceId}>
                                    {d.displayName}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            )}
                          </>
                        )}
                      </SelectContent>
                    </Select>
                    <Button 
                      variant="outline" 
                      size="icon" 
                      onClick={refreshDevices}
                      title="Refresh devices"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                  </div>
                  
                  {/* Show All Devices toggle */}
                  <div className="flex items-center gap-2">
                    <Switch 
                      checked={showAllDevices} 
                      onCheckedChange={setShowAllDevices}
                      id="show-all-devices"
                    />
                    <Label htmlFor="show-all-devices" className="text-xs text-muted-foreground cursor-pointer">
                      Show all devices (if capture card not detected)
                    </Label>
                  </div>
                </div>
              );
            })()}

            <div className="flex items-center gap-4 py-3">
              <span className="text-sm text-muted-foreground w-24">Capture Rate</span>
              <Slider
                value={[state.captureRate]}
                onValueChange={([v]) => setCaptureRate(v)}
                min={1}
                max={5}
                step={1}
                className="flex-1"
              />
              <span className="text-sm font-mono w-16">{state.captureRate} FPS</span>
            </div>
            
            {/* Start Without Video Toggle */}
            <div className="flex items-center justify-between py-3 border-t">
              <div>
                <Label className="text-sm font-medium">Start Without Video</Label>
                <p className="text-xs text-muted-foreground">
                  Box score projections run automatically (video adds vision signals)
                </p>
              </div>
              <Switch
                checked={dataOnlyMode}
                onCheckedChange={setDataOnlyMode}
              />
            </div>
          </CardContent>
        )}
      </Card>

      {/* Video Preview + Stats Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Video Preview */}
        <Card className="lg:col-span-2 border-border/50 overflow-hidden">
          <div className="relative aspect-video bg-black">
            <video 
              ref={videoRef} 
              autoPlay 
              muted 
              playsInline
              className="w-full h-full object-contain"
            />
            
            {/* Status Overlay */}
            {state.isRunning && (
              <div className="absolute top-3 left-3 flex items-center gap-2">
                <div className={cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-full",
                  state.isPaused ? "bg-chart-4/80" : "bg-background/60"
                )}>
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    state.isPaused ? "bg-chart-4" : "bg-destructive animate-pulse"
                  )} />
                  <span className="text-foreground text-sm font-medium">
                    {state.isPaused ? 'PAUSED' : 'LIVE'}
                  </span>
                </div>
                
                {state.currentGameTime && (
                  <Badge variant="outline" className="text-white border-white/50 font-mono">
                    {state.currentGameTime}
                  </Badge>
                )}
                
                {state.currentScore && (
                  <Badge variant="outline" className="text-white border-white/50">
                    {state.currentScore}
                  </Badge>
                )}
              </div>
            )}

            {/* Stats Overlay */}
            {state.isRunning && (
              <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between">
                <div className="flex items-center gap-3 text-xs text-white/80">
                  <span>Frames: {state.framesProcessed}</span>
                  <span>Analyses: {state.analysisCount}</span>
                  <span>Skipped: {state.commercialSkipCount}</span>
                </div>
              </div>
            )}

            {/* Not capturing placeholder */}
            {!state.isRunning && (
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center text-white/60">
                  <Bot className="w-16 h-16 mx-auto mb-4 opacity-50" />
                  <p>Click "Start Autopilot" to begin monitoring</p>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Quick Stats */}
        <Card className="border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Live Stats
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-2 bg-muted/50 rounded text-center">
                <p className="text-2xl font-bold">{topEdges.length}</p>
                <p className="text-xs text-muted-foreground">Active Edges</p>
              </div>
              <div className="p-2 bg-muted/50 rounded text-center">
                <p className="text-2xl font-bold text-destructive">{fatiguedPlayers.length}</p>
                <p className="text-xs text-muted-foreground">Fatigued</p>
              </div>
            </div>

            {/* Top Fatigued Players Quick View */}
            {fatiguedPlayers.slice(0, 3).map(player => (
              <div key={player.playerName} className="flex items-center justify-between text-sm p-2 bg-destructive/10 rounded">
                <span>#{player.jersey} {player.playerName.split(' ').pop()}</span>
                <Badge variant="destructive" className="text-xs">
                  F:{player.fatigueScore}%
                </Badge>
              </div>
            ))}

            {state.pbpData && (
              <div className="pt-2 border-t space-y-2">
                <PaceMeter pace={state.pbpData.pace || 100} />
                <p className="text-xs text-muted-foreground text-center">
                  {state.pbpData.isHalftime ? '⏸️ Halftime' : state.pbpData.isGameOver ? '✅ Final' : '🏀 In Progress'}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeScoutTab} onValueChange={(v) => setActiveScoutTab(v as 'bets' | 'props' | 'advanced')}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="bets" className="gap-2">
            <TrendingUp className="w-4 h-4" />
            <span className="hidden sm:inline">Game Bets</span>
            <span className="sm:hidden">Bets</span>
            {gameBetEdges.filter(e => e.confidence >= 65).length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs h-5 min-w-5 px-1">
                {gameBetEdges.filter(e => e.confidence >= 65).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="props" className="gap-2">
            <Target className="w-4 h-4" />
            <span className="hidden sm:inline">Player Props</span>
            <span className="sm:hidden">Props</span>
            {state.activePropEdges.filter(e => e.confidence >= 65).length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs h-5 min-w-5 px-1">
                {state.activePropEdges.filter(e => e.confidence >= 65).length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-2">
            <Activity className="w-4 h-4" />
            <span className="hidden sm:inline">Advanced</span>
            <span className="sm:hidden">Adv</span>
          </TabsTrigger>
        </TabsList>
        
        {/* Game Bets Tab */}
        <TabsContent value="bets" className="mt-4">
          <GameBetsTab
            homeTeamState={homeTeamState}
            awayTeamState={awayTeamState}
            gameBetEdges={gameBetEdges}
            gameTime={state.currentGameTime || ''}
          />
        </TabsContent>
        
        {/* Player Props Tab */}
        <TabsContent value="props" className="mt-4">
          <HalftimeBettingPanel
            edges={state.activePropEdges}
            mode={state.halftimeLock.isLocked ? 'HALFTIME_LOCK' : 'LIVE'}
            lockedRecommendations={state.halftimeLock.lockedRecommendations}
            gameTime={state.currentGameTime || ''}
            lockTime={state.halftimeLock.lockTime}
            homeTeamState={homeTeamState}
            awayTeamState={awayTeamState}
            gameBetEdges={gameBetEdges}
            onRefreshStats={refreshPBPData}
            isRefreshing={isRefreshing}
            lastPbpUpdate={lastPbpUpdate}
            lastPbpGameTime={lastPbpGameTime}
            playerStates={state.playerStates}
          />
        </TabsContent>
        
        {/* Advanced Tab */}
        <TabsContent value="advanced" className="mt-4 space-y-4">
          {/* Players Grid */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Users className="w-4 h-4" />
                Player States ({onCourtPlayers.length})
              </CardTitle>
            </CardHeader>
            <CardContent>
              {onCourtPlayers.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {onCourtPlayers
                    .sort((a, b) => b.fatigueScore - a.fatigueScore)
                    .map(player => {
                      const playerLastName = player.playerName.split(' ').pop()?.toLowerCase() || '';
                      const playerEdges = state.activePropEdges.filter(e => 
                        e.player.toLowerCase().includes(playerLastName)
                      );
                      return (
                        <PlayerStateCard 
                          key={player.playerName} 
                          player={player} 
                          playerPropEdges={playerEdges}
                        />
                      );
                    })}
                </div>
              ) : allPlayers.length > 0 ? (
                <div className="text-center py-6 text-muted-foreground">
                  <Activity className="w-10 h-10 mx-auto mb-3 opacity-50 animate-pulse" />
                  <p className="font-medium">Warming up...</p>
                  <p className="text-sm">{allPlayers.length} players loaded</p>
                </div>
              ) : (
                <div className="text-center py-6 text-muted-foreground">
                  <Users className="w-10 h-10 mx-auto mb-3 opacity-50" />
                  <p>No player data yet</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Scene Log */}
          <Card className="border-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Activity Log ({state.sceneHistory.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <ScrollArea className="h-48">
                <div className="p-3 space-y-2">
                  {state.sceneHistory.slice(0, 20).map((scene, idx) => (
                    <div 
                      key={idx} 
                      className={cn(
                        "flex items-center justify-between text-xs p-2 rounded",
                        scene.isAnalysisWorthy ? "bg-chart-2/10" : "bg-muted/50"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        {scene.isAnalysisWorthy ? (
                          <Zap className="w-3 h-3 text-chart-2" />
                        ) : (
                          <AlertTriangle className="w-3 h-3 text-muted-foreground" />
                        )}
                        <span className="font-mono text-muted-foreground">
                          {scene.gameTime || '--:--'}
                        </span>
                        <span>{scene.sceneType}</span>
                      </div>
                      <span className="text-muted-foreground">{scene.reason}</span>
                    </div>
                  ))}
                  
                  {state.sceneHistory.length === 0 && (
                    <div className="text-center py-6 text-muted-foreground">
                      No activity logged yet
                    </div>
                  )}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>

          {/* Pace Meter in Advanced Tab */}
          {state.pbpData && (
            <Card className="border-border/50">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Game Pace</CardTitle>
              </CardHeader>
              <CardContent>
                <PaceMeter pace={state.pbpData.pace || 100} />
                <p className="text-xs text-muted-foreground text-center mt-2">
                  {state.pbpData.isHalftime ? '⏸️ Halftime' : state.pbpData.isGameOver ? '✅ Final' : '🏀 In Progress'}
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
