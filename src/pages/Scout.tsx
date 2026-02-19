import React, { useState, useCallback, useEffect } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScoutVideoUpload } from "@/components/scout/ScoutVideoUpload";
import { ScoutAnalysisResults } from "@/components/scout/ScoutAnalysisResults";
import { ScoutGameSelector } from "@/components/scout/ScoutGameSelector";
import { ScoutLiveCapture, LiveObservation } from "@/components/scout/ScoutLiveCapture";
import { ScoutAutonomousAgent } from "@/components/scout/ScoutAutonomousAgent";
import { CustomerScoutView } from "@/components/scout/CustomerScoutView";
import { RiskModeProvider } from "@/contexts/RiskModeContext";
import { FilmProfileUpload } from "@/components/scout/FilmProfileUpload";
import { useToast } from "@/hooks/use-toast";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { Video, Eye, Zap, Clock, Users, Upload, Radio, Bot, Film, Lock, Check, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

import type { PreGameBaseline, TeamFatigueData } from '@/types/pre-game-baselines';

export interface PropLine {
  playerName: string;
  propType: 'points' | 'rebounds' | 'assists';
  line: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
}

export type InjuryStatus = 'OUT' | 'DOUBTFUL' | 'QUESTIONABLE' | 'GTD' | 'DTD' | null;

export interface RosterPlayer {
  name: string;
  jersey: string;
  position: string;
  injuryStatus?: InjuryStatus;
  injuryDetail?: string;
}

export interface ScoutGameContext {
  eventId: string;
  espnEventId?: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  gameDescription: string;
  homeRoster: RosterPlayer[];
  awayRoster: RosterPlayer[];
  propLines?: PropLine[];
  preGameBaselines?: PreGameBaseline[];
  homeTeamFatigue?: TeamFatigueData;
  awayTeamFatigue?: TeamFatigueData;
}

export type GameContext = ScoutGameContext;

export interface AnalysisResult {
  observations: PlayerObservation[];
  teamObservations: {
    [team: string]: {
      defensiveIntensity: number;
      pace: string;
      energyTrend: string;
    };
  };
  paceAssessment: string;
  bettingSignals: string[];
  recommendations: PropRecommendation[];
}

export interface PlayerObservation {
  playerName: string;
  jerseyNumber: string;
  team: string;
  framesDetectedIn: number[];
  movementScore: number;
  fatigueIndicators: string[];
  bodyLanguage: string;
  shotMechanicsNote: string | null;
  confidence: "low" | "medium" | "high";
}

export interface PropRecommendation {
  playerName: string;
  propType: string;
  line: number;
  recommendation: "OVER" | "UNDER" | "PASS";
  confidence: "low" | "medium" | "high";
  reasoning: string;
  visualEvidence: string[];
  actualLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  bookmaker: string | null;
  propAvailable: boolean;
  lineDelta: number | null;
}

const SCOUT_PRICE_ID = "price_1T2br19D6r1PTCBBfrDD4opY";

const scoutFeatures = [
  "Real-time streaming analysis",
  "Live player prop tracking",
  "Game bets & whale signals",
  "Lock Mode advanced picks",
  "AI-powered halftime edges",
  "Full Scout dashboard access",
];

function ScoutUpgradeGate() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [isLoading, setIsLoading] = useState(false);

  const handleStartTrial = async () => {
    const targetEmail = user?.email || email;
    if (!targetEmail || !targetEmail.includes("@")) return;

    setIsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-bot-checkout', {
        body: { email: targetEmail, priceId: SCOUT_PRICE_ID },
      });
      if (error) throw error;
      if (data?.url) window.location.href = data.url;
    } catch (err) {
      console.error('Error starting scout checkout:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <Card className="max-w-md w-full border-2 border-emerald-500/40 bg-card">
        <CardHeader className="text-center">
          <div className="mx-auto w-14 h-14 rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
            <Lock className="w-7 h-7 text-emerald-400" />
          </div>
          <CardTitle className="text-2xl font-bebas tracking-wide">Scout — Live Betting</CardTitle>
          <CardDescription>
            Full access to real-time AI-powered scouting tools
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="text-center">
            <span className="text-4xl font-bold text-foreground">$750</span>
            <span className="text-muted-foreground text-sm">/month</span>
            <p className="text-emerald-400 text-xs mt-1 font-semibold">1-day free trial included</p>
          </div>

          <div className="space-y-2.5">
            {scoutFeatures.map((feature) => (
              <div key={feature} className="flex items-start gap-2.5">
                <Check className="w-4 h-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                <span className="text-sm text-foreground">{feature}</span>
              </div>
            ))}
          </div>

          {!user && (
            <input
              type="email"
              placeholder="Enter your email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 rounded-md border border-border bg-background text-foreground text-sm"
            />
          )}

          <Button
            className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-bold text-base py-5"
            onClick={handleStartTrial}
            disabled={isLoading}
          >
            {isLoading ? "Loading..." : "Start 1-Day Free Trial"}
          </Button>

          <p className="text-xs text-muted-foreground text-center">Cancel anytime · No commitment</p>
        </CardContent>
      </Card>
    </div>
  );
}

const Scout = () => {
  const { toast } = useToast();
  const { isAdmin, hasScoutAccess, isLoading: subLoading } = useSubscription();
  const [selectedGame, setSelectedGame] = useState<GameContext | null>(null);
  const [clipCategory, setClipCategory] = useState<string>("timeout");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedFrames, setExtractedFrames] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("upload");
  const [scoutMode, setScoutMode] = useState<'upload' | 'live' | 'autopilot' | 'profile'>('autopilot');
  const [liveObservations, setLiveObservations] = useState<LiveObservation[]>([]);

  const [searchParams] = useSearchParams();
  const testCustomer = searchParams.get('test_customer') === 'true';
  const isCustomer = (hasScoutAccess && !isAdmin) || testCustomer;
  const hasAccess = isAdmin || hasScoutAccess || testCustomer;

  // Fetch admin-set active game for customers
  const { data: activeGame } = useQuery({
    queryKey: ['scout-active-game'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scout_active_game')
        .select('*')
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: isCustomer,
    staleTime: 30_000,
  });

  // Auto-set selected game from active game for customers
  useEffect(() => {
    if (isCustomer && activeGame && !selectedGame) {
      setSelectedGame({
        eventId: activeGame.event_id,
        homeTeam: activeGame.home_team,
        awayTeam: activeGame.away_team,
        commenceTime: activeGame.commence_time ?? '',
        gameDescription: activeGame.game_description ?? `${activeGame.away_team} @ ${activeGame.home_team}`,
        homeRoster: [],
        awayRoster: [],
      });
    }
  }, [isCustomer, activeGame, selectedGame]);

  // Admin: set live game for customers
  const handleSetLive = async () => {
    if (!selectedGame) return;
    try {
      // Delete existing, then insert new (upsert pattern for single row)
      await supabase.from('scout_active_game').delete().neq('id', '00000000-0000-0000-0000-000000000000');
      const { error } = await supabase.from('scout_active_game').insert({
        event_id: selectedGame.eventId,
        home_team: selectedGame.homeTeam,
        away_team: selectedGame.awayTeam,
        game_description: selectedGame.gameDescription,
        commence_time: selectedGame.commenceTime || null,
      });
      if (error) throw error;
      toast({ title: "Game Set Live", description: `${selectedGame.awayTeam} @ ${selectedGame.homeTeam} is now live for customers` });
    } catch (err) {
      console.error('Error setting live game:', err);
      toast({ title: "Error", description: "Failed to set live game", variant: "destructive" });
    }
  };

  const handleLiveObservationsUpdate = useCallback((observations: LiveObservation[]) => {
    setLiveObservations(observations);
  }, []);

  const handleLiveAnalysisComplete = useCallback((result: AnalysisResult, frames: string[]) => {
    setAnalysisResult(result);
    setExtractedFrames(frames);
    setActiveTab("results");
    toast({
      title: "Halftime Analysis Complete",
      description: `Found ${result.recommendations.length} prop recommendations`,
    });
  }, [toast]);

  const handleGameSelect = useCallback((game: GameContext) => {
    setSelectedGame(game);
    setAnalysisResult(null);
    setExtractedFrames([]);
    toast({
      title: "Game Selected",
      description: `${game.awayTeam} @ ${game.homeTeam}`,
    });
  }, [toast]);

  const handleAnalysisComplete = useCallback((result: AnalysisResult, frames: string[]) => {
    setAnalysisResult(result);
    setExtractedFrames(frames);
    setActiveTab("results");
    toast({
      title: "Analysis Complete",
      description: `Found ${result.observations.length} player observations`,
    });
  }, [toast]);

  // Loading state
  if (subLoading && !testCustomer) {
    return (
      <AppShell className="pt-safe pb-20">
        <div className="flex items-center justify-center min-h-[60vh]">
          <div className="text-muted-foreground">Loading...</div>
        </div>
      </AppShell>
    );
  }

  // Gate: no Scout access
  if (!hasAccess) {
    return (
      <AppShell className="pt-safe pb-20">
        <ScoutUpgradeGate />
      </AppShell>
    );
  }

  return (
    <AppShell className="pt-safe pb-20">
      <div className="space-y-4">
        {/* Header — admin only */}
        {!isCustomer && (
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-display font-bold flex items-center gap-2">
                <Eye className="w-6 h-6 text-primary" />
                Second Half Scout
              </h1>
              <p className="text-sm text-muted-foreground">
                AI-powered video analysis for halftime betting edges
              </p>
            </div>
            <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20">
              <Zap className="w-3 h-3 mr-1" />
              Beta
            </Badge>
          </div>
        )}

        {/* Game Selector — admin only */}
        {!isCustomer && (
          <div className="space-y-2">
            <ScoutGameSelector 
              selectedGame={selectedGame} 
              onGameSelect={handleGameSelect} 
            />
            {selectedGame && (
              <Button
                size="sm"
                variant="outline"
                className="gap-2 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10"
                onClick={handleSetLive}
              >
                <Send className="w-3.5 h-3.5" />
                Set Live for Customers
              </Button>
            )}
          </div>
        )}

        {/* Customer: no game live message */}
        {isCustomer && !selectedGame && !activeGame && (
          <div className="flex items-center justify-center min-h-[40vh]">
            <p className="text-muted-foreground text-sm">No game is currently live. Check back soon.</p>
          </div>
        )}

        {selectedGame && (
          <>
            {/* Mode Toggle — admin only */}
            {!isCustomer && (
              <Tabs value={scoutMode} onValueChange={(v) => setScoutMode(v as 'upload' | 'live' | 'autopilot' | 'profile')} className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="upload" className="gap-1 text-xs sm:text-sm sm:gap-2">
                    <Upload className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Upload</span>
                  </TabsTrigger>
                  <TabsTrigger value="live" className="gap-1 text-xs sm:text-sm sm:gap-2">
                    <Radio className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Live</span>
                  </TabsTrigger>
                  <TabsTrigger value="autopilot" className="gap-1 text-xs sm:text-sm sm:gap-2">
                    <Bot className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Auto</span>
                  </TabsTrigger>
                  <TabsTrigger value="profile" className="gap-1 text-xs sm:text-sm sm:gap-2">
                    <Film className="w-3 h-3 sm:w-4 sm:h-4" />
                    <span className="hidden sm:inline">Profile</span>
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            )}

            {/* Upload mode — admin only */}
            {scoutMode === 'upload' && !isCustomer && (
              <>
                <Card className="border-border/50">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Video className="w-4 h-4 text-chart-3" />
                      Clip Category
                    </CardTitle>
                    <CardDescription>
                      Select what type of footage you're uploading for targeted analysis
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Select value={clipCategory} onValueChange={setClipCategory}>
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Select clip type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="timeout">
                          <div className="flex items-center gap-2">
                            <Clock className="w-4 h-4" />
                            Timeout / Huddle - Fatigue indicators
                          </div>
                        </SelectItem>
                        <SelectItem value="fastbreak">
                          <div className="flex items-center gap-2">
                            <Zap className="w-4 h-4" />
                            Fast Break - Explosion & pace
                          </div>
                        </SelectItem>
                        <SelectItem value="freethrow">
                          <div className="flex items-center gap-2">
                            <span>🎯</span>
                            Free Throws - Shot mechanics
                          </div>
                        </SelectItem>
                        <SelectItem value="defense">
                          <div className="flex items-center gap-2">
                            <Users className="w-4 h-4" />
                            Half-court Defense - Rotation discipline
                          </div>
                        </SelectItem>
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>

                <Tabs value={activeTab} onValueChange={setActiveTab}>
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upload">Upload & Analyze</TabsTrigger>
                    <TabsTrigger value="results" disabled={!analysisResult}>
                      Results {analysisResult && `(${analysisResult.recommendations.length})`}
                    </TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upload" className="mt-4">
                    <ScoutVideoUpload
                      gameContext={selectedGame}
                      clipCategory={clipCategory}
                      onAnalysisComplete={handleAnalysisComplete}
                      isAnalyzing={isAnalyzing}
                      setIsAnalyzing={setIsAnalyzing}
                    />
                  </TabsContent>
                  
                  <TabsContent value="results" className="mt-4">
                    {analysisResult && (
                      <ScoutAnalysisResults
                        result={analysisResult}
                        frames={extractedFrames}
                        gameContext={selectedGame}
                      />
                    )}
                  </TabsContent>
                </Tabs>
              </>
            )}

            {/* Live mode — admin only */}
            {scoutMode === 'live' && !isCustomer && (
              <div className="space-y-4">
                <ScoutLiveCapture
                  gameContext={selectedGame}
                  onObservationsUpdate={handleLiveObservationsUpdate}
                  onHalftimeAnalysis={handleLiveAnalysisComplete}
                />
                {analysisResult && (
                  <ScoutAnalysisResults
                    result={analysisResult}
                    frames={extractedFrames}
                    gameContext={selectedGame}
                  />
                )}
              </div>
            )}

            {/* Customer view: Stream + Props + Hedges */}
            {isCustomer && (
              <RiskModeProvider>
                <CustomerScoutView gameContext={selectedGame} />
              </RiskModeProvider>
            )}

            {/* Autopilot mode — admin only */}
            {!isCustomer && scoutMode === 'autopilot' && (
              <ScoutAutonomousAgent gameContext={selectedGame} isCustomer={false} />
            )}

            {/* Profile mode — admin only */}
            {scoutMode === 'profile' && !isCustomer && (
              <FilmProfileUpload 
                onProfileUpdated={(playerName, profileData) => {
                  toast({
                    title: "Profile Built",
                    description: `${playerName}'s behavior profile updated with film insights`,
                  });
                }}
              />
            )}
          </>
        )}

        {/* Info Section — admin only */}
        {!selectedGame && !isCustomer && (
          <Card className="border-dashed border-2 border-muted-foreground/20">
            <CardContent className="py-8 text-center">
              <Video className="w-12 h-12 mx-auto mb-4 text-muted-foreground/50" />
              <h3 className="font-semibold mb-2">How It Works</h3>
              <ol className="text-sm text-muted-foreground space-y-2 text-left max-w-md mx-auto">
                <li>1. Select today's game you're watching</li>
                <li>2. Record 30-60 second clips during Q1/Q2</li>
                <li>3. Upload clips at halftime for AI analysis</li>
                <li>4. Get visual-based betting signals for 2H</li>
              </ol>
              <div className="mt-4 p-3 bg-primary/10 rounded-lg">
                <p className="text-xs text-primary">
                  <strong>Pro Tip:</strong> Best clips are timeouts, fast breaks, and free throw routines - 
                  these reveal fatigue and mechanics most clearly.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
};

export default Scout;