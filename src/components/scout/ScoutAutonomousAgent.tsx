import React, { useState, useRef, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { useScoutAgentState } from '@/hooks/useScoutAgentState';
import { PlayerStateCard } from './PlayerStateCard';
import { PropEdgeList } from './PropEdgeAlert';
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
} from '@/lib/live-stream-capture';
import {
  Bot,
  Play,
  Square,
  Pause,
  Settings,
  Activity,
  Users,
  Target,
  Zap,
  Monitor,
  Camera,
  AlertTriangle,
} from 'lucide-react';
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
  const [activeTab, setActiveTab] = useState('players');
  
  // Capture mode state
  const [captureMode, setCaptureMode] = useState<'screen' | 'camera'>('screen');
  const [videoDevices, setVideoDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('');
  
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
  } = useScoutAgentState({ gameContext });

  const isSupported = isScreenCaptureSupported() || isCameraSupported();

  // Load video devices on mount
  useEffect(() => {
    async function loadDevices() {
      const devices = await getVideoDevices();
      setVideoDevices(devices);
      if (devices.length > 0 && !selectedDeviceId) {
        setSelectedDeviceId(devices[0].deviceId);
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

  // Main capture loop
  useEffect(() => {
    if (state.isRunning && !state.isPaused && mediaStream && videoRef.current) {
      const intervalMs = Math.round(1000 / state.captureRate);
      
      captureIntervalRef.current = setInterval(() => {
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

  const fetchPBPData = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('fetch-live-pbp', {
        body: { eventId: gameContext.eventId },
      });
      
      if (!error && data) {
        updatePBPData(data);
      }
    } catch (error) {
      console.error('[Autopilot] PBP fetch error:', error);
    }
  };

  const runAgentLoop = async () => {
    if (!videoRef.current || !state.isRunning || state.isPaused) return;
    
    try {
      const frame = captureFrame(videoRef.current, 0.7); // Lower quality for speed
      
      const { data, error } = await supabase.functions.invoke('scout-agent-loop', {
        body: {
          frame,
          gameContext: state.gameContext,
          playerStates: getStateForAPI(),
          pbpData: state.pbpData,
          existingEdges: state.activePropEdges,
          currentGameTime: state.currentGameTime,
        },
      });
      
      if (!error && data) {
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
      console.error('[Autopilot] Agent loop error:', error);
    }
  };

  const handleStart = async () => {
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
                <CardTitle className="text-lg">Scout Autopilot</CardTitle>
                <CardDescription>
                  {state.isRunning 
                    ? `Monitoring at ${state.captureRate} FPS` 
                    : 'Autonomous game monitoring'}
                </CardDescription>
              </div>
            </div>
            
            <div className="flex items-center gap-2">
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
                <Button 
                  onClick={handleStart} 
                  className="gap-2"
                  disabled={captureMode === 'camera' && videoDevices.length === 0}
                >
                  <Play className="w-4 h-4" />
                  Start Autopilot
                </Button>
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
            {!state.isRunning && captureMode === 'camera' && (
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
                  state.isPaused ? "bg-chart-4/80" : "bg-black/60"
                )}>
                  <div className={cn(
                    "w-3 h-3 rounded-full",
                    state.isPaused ? "bg-chart-4" : "bg-red-500 animate-pulse"
                  )} />
                  <span className="text-white text-sm font-medium">
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
              <div className="pt-2 border-t text-xs text-muted-foreground">
                <p>Pace: {state.pbpData.pace} poss/48</p>
                <p>{state.pbpData.isHalftime ? '⏸️ Halftime' : state.pbpData.isGameOver ? '✅ Final' : '🏀 In Progress'}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="players" className="gap-2">
            <Users className="w-4 h-4" />
            Players ({onCourtPlayers.length})
          </TabsTrigger>
          <TabsTrigger value="edges" className="gap-2">
            <Target className="w-4 h-4" />
            Edges ({topEdges.length})
          </TabsTrigger>
          <TabsTrigger value="log" className="gap-2">
            <Activity className="w-4 h-4" />
            Log
          </TabsTrigger>
        </TabsList>

        <TabsContent value="players" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {onCourtPlayers
              .sort((a, b) => b.fatigueScore - a.fatigueScore)
              .map(player => (
                <PlayerStateCard key={player.playerName} player={player} />
              ))}
          </div>
          
          {onCourtPlayers.length === 0 && allPlayers.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Users className="w-12 h-12 mx-auto mb-4 opacity-50" />
              <p>No player data yet</p>
              <p className="text-sm">Start autopilot to begin tracking</p>
            </div>
          )}
          
          {onCourtPlayers.length === 0 && allPlayers.length > 0 && (
            <div className="text-center py-8 text-muted-foreground">
              <Activity className="w-12 h-12 mx-auto mb-4 opacity-50 animate-pulse" />
              <p className="font-medium">Warming up...</p>
              <p className="text-sm">{allPlayers.length} players loaded, analyzing frames</p>
              <p className="text-xs mt-2">Frames: {state.framesProcessed} | Analyses: {state.analysisCount}</p>
            </div>
          )}
        </TabsContent>

        <TabsContent value="edges" className="mt-4">
          <PropEdgeList edges={state.activePropEdges} maxDisplay={10} />
        </TabsContent>

        <TabsContent value="log" className="mt-4">
          <Card className="border-border/50">
            <CardContent className="p-0">
              <ScrollArea className="h-64">
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
        </TabsContent>
      </Tabs>
    </div>
  );
}
