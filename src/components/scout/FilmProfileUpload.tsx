import React, { useState, useCallback, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { 
  extractFramesFromVideo, 
  validateVideoFile, 
  deduplicateFrames,
  type ExtractionProgress 
} from "@/lib/video-frame-extractor";
import { YouTubeLinkInput, VideoInfo } from "./YouTubeLinkInput";
import { 
  Upload, 
  Link2, 
  Video, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Search,
  Film,
  User,
  ImageIcon,
  Sparkles,
  X,
} from "lucide-react";

interface FilmProfileUploadProps {
  onProfileUpdated?: (playerName: string, profileData: any) => void;
}

interface PlayerSearchResult {
  id: string;
  player_name: string;
  team_name: string;
  position: string;
}

interface UpdatedProfileResult {
  player_name: string;
  team: string;
  fatigue_tendency?: string;
  body_language_notes?: string;
  film_sample_count?: number;
  profile_confidence?: number;
  // Enhanced tracking data for UI display
  courtZones?: Record<string, number>;
  shotAttempts?: Array<{ zone: string; result: string; type: string }>;
  defensiveMatchups?: Array<{ opponent: string; closeoutQuality: number; helpTiming: string }>;
  rotationSignals?: {
    stintsObserved: number;
    benchTimeVisible: boolean;
    fatigueOnReentry: string;
  };
}

interface PlayerTracking {
  playerName: string;
  jerseyNumber: string;
  framesDetected: number[];
  courtZones: Record<string, number>;
  shotAttempts: Array<{ zone: string; result: string; type: string }>;
  rotationSignals: {
    stintsObserved: number;
    benchTimeVisible: boolean;
    fatigueOnReentry: string;
  };
  defensiveMatchups: Array<{ opponent: string; closeoutQuality: number; helpTiming: string }>;
  movementScore: number;
  fatigueIndicators: string[];
  confidence: string;
}

type AnalysisStage = 'idle' | 'uploading' | 'extracting' | 'analyzing' | 'updating' | 'complete' | 'error';

const MAX_PLAYERS = 5;

export function FilmProfileUpload({ onProfileUpdated }: FilmProfileUploadProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Player search state - now supports multiple players
  const [playerSearch, setPlayerSearch] = useState('');
  const [playerResults, setPlayerResults] = useState<PlayerSearchResult[]>([]);
  const [selectedPlayers, setSelectedPlayers] = useState<PlayerSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  
  // Upload state
  const [inputMode, setInputMode] = useState<'upload' | 'youtube'>('youtube');
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
  const [previewFrames, setPreviewFrames] = useState<string[]>([]);
  const [extractedFrames, setExtractedFrames] = useState<string[]>([]);
  const [extractionProgress, setExtractionProgress] = useState<ExtractionProgress | null>(null);
  
  // Analysis state
  const [analysisStage, setAnalysisStage] = useState<AnalysisStage>('idle');
  const [stageProgress, setStageProgress] = useState(0);
  const [stageMessage, setStageMessage] = useState('');
  const [updatedProfiles, setUpdatedProfiles] = useState<UpdatedProfileResult[]>([]);
  const [isProcessingYouTube, setIsProcessingYouTube] = useState(false);

  // Search for players
  const handlePlayerSearch = useCallback(async (query: string) => {
    setPlayerSearch(query);
    
    if (query.length < 2) {
      setPlayerResults([]);
      return;
    }
    
    setIsSearching(true);
    try {
      const { data, error } = await supabase
        .from('bdl_player_cache')
        .select('id, player_name, team_name, position')
        .ilike('player_name', `%${query}%`)
        .eq('is_active', true)
        .limit(8);
      
      if (error) throw error;
      setPlayerResults(data || []);
    } catch (err) {
      console.error('[FilmProfileUpload] Player search error:', err);
    } finally {
      setIsSearching(false);
    }
  }, []);

  const handleSelectPlayer = (player: PlayerSearchResult) => {
    // Don't add duplicates
    if (selectedPlayers.some(p => p.id === player.id)) {
      setPlayerSearch('');
      setPlayerResults([]);
      return;
    }
    
    // Check max limit
    if (selectedPlayers.length >= MAX_PLAYERS) {
      toast({
        title: "Max Players Reached",
        description: `You can select up to ${MAX_PLAYERS} players per upload`,
        variant: "destructive",
      });
      return;
    }
    
    setSelectedPlayers(prev => [...prev, player]);
    setPlayerSearch(''); // Clear search after adding
    setPlayerResults([]);
  };

  const handleRemovePlayer = (playerId: string) => {
    setSelectedPlayers(prev => prev.filter(p => p.id !== playerId));
  };

  // Handle file upload
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
    setExtractedFrames([]);

    try {
      setExtractionProgress({
        stage: 'loading',
        currentFrame: 0,
        totalFrames: 0,
        message: 'Loading video...',
      });

      const result = await extractFramesFromVideo(file, setExtractionProgress);
      const uniqueFrames = deduplicateFrames(result.frames);
      
      setPreviewFrames(uniqueFrames.slice(0, 4).map(f => f.base64));
      setExtractedFrames(uniqueFrames.map(f => f.base64));
      
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
      console.error('[FilmProfileUpload] Frame extraction error:', err);
      setExtractionProgress({
        stage: 'error',
        currentFrame: 0,
        totalFrames: 0,
        message: err instanceof Error ? err.message : 'Failed to process video',
      });
      toast({
        title: "Extraction Failed",
        description: "Try a shorter clip or use a YouTube link instead",
        variant: "destructive",
      });
    }
  }, [toast]);

  // Handle YouTube frames extraction
  const handleYouTubeFrames = useCallback((frames: string[], videoInfo: VideoInfo) => {
    setExtractedFrames(frames);
    setPreviewFrames(frames.slice(0, 4));
    toast({
      title: "Frames Extracted",
      description: `Got ${frames.length} frames from ${videoInfo.platform}`,
    });
  }, [toast]);

  const handleYouTubeError = useCallback((error: string) => {
    toast({
      title: "Extraction Failed",
      description: error,
      variant: "destructive",
    });
  }, [toast]);

  // Helper function to find player tracking data
  const findPlayerTracking = (trackingArray: PlayerTracking[], playerName: string): PlayerTracking | undefined => {
    if (!trackingArray || trackingArray.length === 0) return undefined;
    const lastName = playerName.split(' ').pop()?.toLowerCase() || playerName.toLowerCase();
    return trackingArray.find((t: PlayerTracking) => 
      t.playerName?.toLowerCase().includes(lastName)
    );
  };

  // Analyze and update profiles for ALL selected players with enhanced tracking
  const handleAnalyzeAndUpdate = useCallback(async () => {
    if (selectedPlayers.length === 0 || extractedFrames.length === 0) {
      toast({
        title: "Missing Information",
        description: "Please select at least one player and provide video frames",
        variant: "destructive",
      });
      return;
    }

    setAnalysisStage('analyzing');
    setStageProgress(20);
    setStageMessage(`Analyzing footage for ${selectedPlayers.length} player${selectedPlayers.length > 1 ? 's' : ''}...`);
    setUpdatedProfiles([]);

    try {
      // Step 1: Analyze frames with vision AI (single call for all players)
      setStageProgress(40);
      
      // Pass selected player names for enhanced tracking
      const selectedPlayerNames = selectedPlayers.map(p => p.player_name);
      
      const { data: analysisData, error: analysisError } = await supabase.functions.invoke('analyze-game-footage', {
        body: {
          frames: extractedFrames.slice(0, 20), // Limit to 20 frames
          gameContext: {
            homeTeam: selectedPlayers[0].team_name || 'Unknown',
            awayTeam: 'Opponent',
            homeRoster: selectedPlayers.map(p => `${p.player_name} (${p.position})`).join(', '),
            awayRoster: '',
            eventId: 'profile-upload',
          },
          clipCategory: 'timeout', // Default to timeout for fatigue analysis
          selectedPlayers: selectedPlayerNames, // NEW: Pass selected players for tracking
        },
      });

      if (analysisError) throw analysisError;

      setStageProgress(60);
      setStageMessage(`Updating ${selectedPlayers.length} player profile${selectedPlayers.length > 1 ? 's' : ''}...`);
      setAnalysisStage('updating');

      // Step 2: Update profile for EACH selected player with enhanced tracking data
      const observations = analysisData?.analysis?.observations || [];
      const playerTracking = analysisData?.analysis?.playerTracking || [];
      const results: UpdatedProfileResult[] = [];

      for (let i = 0; i < selectedPlayers.length; i++) {
        const player = selectedPlayers[i];
        const tracking = findPlayerTracking(playerTracking, player.player_name);
        const playerObs = observations.find((o: any) => 
          o.playerName?.toLowerCase().includes(player.player_name.split(' ').pop()?.toLowerCase() || '')
        ) || observations[0];

        // Calculate progress per player
        const progressPerPlayer = 30 / selectedPlayers.length;
        setStageProgress(60 + (i + 1) * progressPerPlayer);

        // Build enhanced data from tracking
        const zoneDistribution = tracking?.courtZones 
          ? Object.entries(tracking.courtZones).map(([zone, count]) => `${zone}: ${count}`).join(', ')
          : '';
        
        const defensiveNotes = tracking?.defensiveMatchups?.map((m: any) => 
          `vs ${m.opponent}: closeout ${m.closeoutQuality}/10, help ${m.helpTiming}`
        ).join('; ') || '';
        
        const shotNotes = tracking?.shotAttempts?.map((s: any) => 
          `${s.zone} ${s.result} (${s.type})`
        ).join(', ') || '';

        // Build body language notes with all tracking data
        const datePrefix = `[${new Date().toISOString().split('T')[0]}]`;
        const bodyLangParts = [];
        if (tracking?.courtZones && Object.keys(tracking.courtZones).length > 0) {
          bodyLangParts.push(`Zones: ${zoneDistribution}`);
        }
        if (defensiveNotes) {
          bodyLangParts.push(`Defense: ${defensiveNotes}`);
        }
        if (shotNotes) {
          bodyLangParts.push(`Shots: ${shotNotes}`);
        }
        if (playerObs?.bodyLanguage) {
          bodyLangParts.push(`Body lang: ${playerObs.bodyLanguage}`);
        }

        // Build zone preferences for scoring_zone_preferences field
        const zonePreferences: Record<string, number> = {};
        if (tracking?.shotAttempts) {
          tracking.shotAttempts.forEach((shot: any) => {
            zonePreferences[shot.zone] = (zonePreferences[shot.zone] || 0) + 1;
          });
        }

        // Upsert profile with enhanced tracking data
        const { data: profileData, error: profileError } = await supabase
          .from('player_behavior_profiles')
          .upsert({
            player_name: player.player_name,
            team: player.team_name,
            // Film-derived insights
            fatigue_tendency: tracking?.fatigueIndicators?.join(', ') || playerObs?.fatigueIndicators?.join(', ') || null,
            body_language_notes: bodyLangParts.length > 0 
              ? `${datePrefix} ${bodyLangParts.join('. ')}`
              : null,
            film_sample_count: 1, // Will be incremented on subsequent uploads
            profile_confidence: Math.min(50, (tracking?.confidence === 'high' ? 25 : playerObs?.confidence === 'high' ? 20 : 10)),
            // Enhanced fields
            scoring_zone_preferences: Object.keys(zonePreferences).length > 0 ? zonePreferences : null,
            updated_at: new Date().toISOString(),
          }, {
            onConflict: 'player_name',
          })
          .select()
          .single();

        if (profileError) {
          console.error(`[FilmProfileUpload] Profile update error for ${player.player_name}:`, profileError);
        }

        // Include tracking data in result for UI display
        results.push({
          player_name: player.player_name,
          team: player.team_name,
          fatigue_tendency: tracking?.fatigueIndicators?.join(', ') || playerObs?.fatigueIndicators?.join(', '),
          body_language_notes: bodyLangParts.length > 0 ? bodyLangParts.join('. ') : undefined,
          courtZones: tracking?.courtZones,
          shotAttempts: tracking?.shotAttempts,
          defensiveMatchups: tracking?.defensiveMatchups,
          rotationSignals: tracking?.rotationSignals,
          film_sample_count: profileData?.film_sample_count,
        });

        onProfileUpdated?.(player.player_name, profileData);
      }

      setStageProgress(100);
      setStageMessage(`${results.length} profile${results.length > 1 ? 's' : ''} updated successfully!`);
      setAnalysisStage('complete');
      setUpdatedProfiles(results);

      toast({
        title: "Profiles Updated",
        description: `${results.length} player${results.length > 1 ? 's\'' : '\'s'} behavior profile${results.length > 1 ? 's have' : ' has'} been enriched`,
      });

    } catch (err) {
      console.error('[FilmProfileUpload] Analysis error:', err);
      setAnalysisStage('error');
      setStageMessage(err instanceof Error ? err.message : 'Analysis failed');
      toast({
        title: "Analysis Failed",
        description: err instanceof Error ? err.message : "Could not analyze footage",
        variant: "destructive",
      });
    }
  }, [selectedPlayers, extractedFrames, toast, onProfileUpdated]);

  const handleReset = () => {
    setSelectedPlayers([]);
    setPlayerSearch('');
    setUploadedFile(null);
    setPreviewFrames([]);
    setExtractedFrames([]);
    setExtractionProgress(null);
    setAnalysisStage('idle');
    setStageProgress(0);
    setStageMessage('');
    setUpdatedProfiles([]);
  };

  const isReady = selectedPlayers.length > 0 && extractedFrames.length > 0;
  const isProcessing = analysisStage === 'analyzing' || analysisStage === 'updating' || isProcessingYouTube;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Film className="w-4 h-4 text-primary" />
          Build Player Profile from Film
        </CardTitle>
        <CardDescription>
          Upload game footage or paste a video link to extract behavioral insights
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Player Search */}
        <div className="space-y-2">
          <label className="text-sm font-medium flex items-center gap-2">
            <User className="w-4 h-4 text-muted-foreground" />
            Select Players
            <span className="text-xs text-muted-foreground font-normal">
              ({selectedPlayers.length}/{MAX_PLAYERS})
            </span>
          </label>
          
          {/* Selected Players Badges */}
          {selectedPlayers.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selectedPlayers.map((player) => (
                <Badge 
                  key={player.id} 
                  variant="secondary" 
                  className="gap-1 pr-1"
                >
                  <User className="w-3 h-3" />
                  {player.player_name}
                  <button
                    onClick={() => handleRemovePlayer(player.id)}
                    disabled={isProcessing}
                    className="ml-1 p-0.5 rounded-full hover:bg-muted-foreground/20 transition-colors disabled:opacity-50"
                    aria-label={`Remove ${player.player_name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </Badge>
              ))}
            </div>
          )}
          
          {/* Search Input */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder={selectedPlayers.length >= MAX_PLAYERS ? "Max players reached" : "Search player name..."}
              value={playerSearch}
              onChange={(e) => handlePlayerSearch(e.target.value)}
              disabled={isProcessing || selectedPlayers.length >= MAX_PLAYERS}
              className="pl-10"
            />
            {isSearching && (
              <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-muted-foreground" />
            )}
          </div>
          
          {/* Search Results Dropdown */}
          {playerResults.length > 0 && (
            <div className="absolute z-10 w-full mt-1 bg-background border border-border rounded-lg shadow-lg max-h-48 overflow-auto">
              {playerResults.map((player) => {
                const isSelected = selectedPlayers.some(p => p.id === player.id);
                return (
                  <button
                    key={player.id}
                    onClick={() => handleSelectPlayer(player)}
                    disabled={isSelected}
                    className={`w-full px-3 py-2 text-left transition-colors flex items-center justify-between ${
                      isSelected 
                        ? 'opacity-50 cursor-not-allowed bg-muted' 
                        : 'hover:bg-muted'
                    }`}
                  >
                    <span className="font-medium">
                      {player.player_name}
                      {isSelected && <span className="text-xs ml-2 text-muted-foreground">(selected)</span>}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {player.team_name} • {player.position}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Input Mode Tabs */}
        <Tabs value={inputMode} onValueChange={(v) => setInputMode(v as 'upload' | 'youtube')}>
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="youtube" className="gap-2" disabled={isProcessing}>
              <Link2 className="w-4 h-4" />
              YouTube Link
            </TabsTrigger>
            <TabsTrigger value="upload" className="gap-2" disabled={isProcessing}>
              <Upload className="w-4 h-4" />
              Upload File
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="youtube" className="mt-4">
            <YouTubeLinkInput
              onFramesExtracted={handleYouTubeFrames}
              onError={handleYouTubeError}
              isProcessing={isProcessingYouTube}
              setIsProcessing={setIsProcessingYouTube}
              disabled={isProcessing}
            />
          </TabsContent>
          
          <TabsContent value="upload" className="mt-4 space-y-4">
            {/* Upload Area */}
            <div
              onClick={() => !isProcessing && fileInputRef.current?.click()}
              className={`
                border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
                transition-colors duration-200
                ${isProcessing ? 'opacity-50 cursor-not-allowed' : 'hover:border-primary hover:bg-primary/5'}
                ${uploadedFile ? 'border-primary bg-primary/5' : 'border-muted-foreground/30'}
              `}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept="video/*"
                onChange={handleFileSelect}
                className="hidden"
                disabled={isProcessing}
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

            {/* Extraction Progress */}
            {extractionProgress && extractionProgress.stage !== 'complete' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{extractionProgress.message}</span>
                  <Loader2 className="w-4 h-4 animate-spin text-primary" />
                </div>
                <Progress 
                  value={(extractionProgress.currentFrame / Math.max(1, extractionProgress.totalFrames)) * 100} 
                  className="h-2" 
                />
              </div>
            )}
          </TabsContent>
        </Tabs>

        {/* Preview Frames */}
        {previewFrames.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <ImageIcon className="w-4 h-4" />
              Preview ({extractedFrames.length} frames ready)
              <CheckCircle className="w-4 h-4 text-chart-2" />
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

        {/* Analysis Progress */}
        {(analysisStage === 'analyzing' || analysisStage === 'updating') && (
          <div className="space-y-2 p-4 bg-primary/10 rounded-lg border border-primary/30">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">{stageMessage}</span>
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
            </div>
            <Progress value={stageProgress} className="h-2" />
          </div>
        )}

        {/* Success State - Multiple Profiles with Enhanced Tracking */}
        {analysisStage === 'complete' && updatedProfiles.length > 0 && (
          <div className="space-y-3">
            {updatedProfiles.map((profile, i) => (
              <div key={i} className="p-4 bg-chart-2/10 rounded-lg border border-chart-2/30">
                <div className="flex items-center gap-2 text-chart-2">
                  <CheckCircle className="w-5 h-5" />
                  <span className="font-medium">{profile.player_name}</span>
                  {profile.team && (
                    <Badge variant="outline" className="text-xs">
                      {profile.team}
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground space-y-2 mt-3">
                  {/* Court Zones */}
                  {profile.courtZones && Object.keys(profile.courtZones).length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs font-medium text-primary">Court Zones:</span>
                      {Object.entries(profile.courtZones).map(([zone, count]) => (
                        <Badge key={zone} variant="secondary" className="text-xs">
                          {zone}: {count as number}
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  {/* Shot Attempts */}
                  {profile.shotAttempts && profile.shotAttempts.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs font-medium text-chart-2">Shots:</span>
                      {profile.shotAttempts.map((s, idx) => (
                        <Badge 
                          key={idx} 
                          variant={s.result === 'made' ? 'default' : 'outline'} 
                          className="text-xs"
                        >
                          {s.zone} {s.result} ({s.type})
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  {/* Defensive Matchups */}
                  {profile.defensiveMatchups && profile.defensiveMatchups.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      <span className="text-xs font-medium text-chart-4">Defense:</span>
                      {profile.defensiveMatchups.map((m, idx) => (
                        <Badge key={idx} variant="outline" className="text-xs">
                          vs {m.opponent} ({m.closeoutQuality}/10, {m.helpTiming})
                        </Badge>
                      ))}
                    </div>
                  )}
                  
                  {/* Rotation Signals */}
                  {profile.rotationSignals && (
                    <div className="text-xs">
                      <span className="font-medium text-chart-5">Rotation:</span>{' '}
                      {profile.rotationSignals.stintsObserved} stint{profile.rotationSignals.stintsObserved !== 1 ? 's' : ''} observed
                      {profile.rotationSignals.benchTimeVisible && ', bench time visible'}
                      {profile.rotationSignals.fatigueOnReentry !== 'none' && 
                        `, fatigue on reentry: ${profile.rotationSignals.fatigueOnReentry}`
                      }
                    </div>
                  )}
                  
                  {/* Fatigue Signals */}
                  {profile.fatigue_tendency && (
                    <p className="text-xs">
                      <span className="font-medium text-destructive">Fatigue:</span> {profile.fatigue_tendency}
                    </p>
                  )}
                  
                  {/* No Data State */}
                  {!profile.courtZones && !profile.shotAttempts?.length && !profile.defensiveMatchups?.length && 
                   !profile.fatigue_tendency && !profile.body_language_notes && (
                    <p className="text-muted-foreground/60 italic text-xs">
                      No tracking data extracted - player may not be visible in footage
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Error State */}
        {analysisStage === 'error' && (
          <div className="flex items-center gap-2 text-destructive text-sm p-3 bg-destructive/10 rounded-lg border border-destructive/30">
            <AlertCircle className="w-4 h-4" />
            {stageMessage}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          <Button
            onClick={handleAnalyzeAndUpdate}
            disabled={!isReady || isProcessing}
            className="flex-1"
            size="lg"
          >
            {isProcessing ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4 mr-2" />
                Analyze & Update {selectedPlayers.length > 1 ? `${selectedPlayers.length} Profiles` : 'Profile'}
              </>
            )}
          </Button>
          
          {(selectedPlayers.length > 0 || extractedFrames.length > 0 || analysisStage !== 'idle') && (
            <Button
              variant="outline"
              onClick={handleReset}
              disabled={isProcessing}
            >
              Reset
            </Button>
          )}
        </div>

        {/* Helper Text */}
        {!isReady && (
          <p className="text-xs text-muted-foreground text-center">
            {selectedPlayers.length === 0 && "Select at least one player above"}
            {selectedPlayers.length > 0 && extractedFrames.length === 0 && " • Add video footage"}
          </p>
        )}
      </CardContent>
    </Card>
  );
}