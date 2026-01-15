import React, { useState, useCallback } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { Video, Eye, Zap, Clock, Users, Upload, Radio, Bot } from "lucide-react";

export interface PropLine {
  playerName: string;
  propType: 'points' | 'rebounds' | 'assists';
  line: number;
  overPrice?: number;
  underPrice?: number;
  bookmaker?: string;
}

export interface GameContext {
  eventId: string;
  homeTeam: string;
  awayTeam: string;
  commenceTime: string;
  gameDescription: string;
  homeRoster: { name: string; jersey: string; position: string }[];
  awayRoster: { name: string; jersey: string; position: string }[];
  propLines?: PropLine[]; // Real betting lines from unified_props
}

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
  // Real bookmaker data (enriched from unified_props)
  actualLine: number | null;
  overPrice: number | null;
  underPrice: number | null;
  bookmaker: string | null;
  propAvailable: boolean;
  lineDelta: number | null;
}

const Scout = () => {
  const { toast } = useToast();
  const [selectedGame, setSelectedGame] = useState<GameContext | null>(null);
  const [clipCategory, setClipCategory] = useState<string>("timeout");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [extractedFrames, setExtractedFrames] = useState<string[]>([]);
  const [activeTab, setActiveTab] = useState("upload");
  const [scoutMode, setScoutMode] = useState<'upload' | 'live' | 'autopilot'>('upload');
  const [liveObservations, setLiveObservations] = useState<LiveObservation[]>([]);

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

  return (
    <AppShell className="pt-safe pb-20">
      <div className="space-y-4">
        {/* Header */}
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

        {/* Game Selector */}
        <ScoutGameSelector 
          selectedGame={selectedGame} 
          onGameSelect={handleGameSelect} 
        />

        {selectedGame && (
          <>
            {/* Mode Toggle */}
            <Tabs value={scoutMode} onValueChange={(v) => setScoutMode(v as 'upload' | 'live' | 'autopilot')} className="w-full">
              <TabsList className="grid w-full grid-cols-3">
                <TabsTrigger value="upload" className="gap-2">
                  <Upload className="w-4 h-4" />
                  Upload
                </TabsTrigger>
                <TabsTrigger value="live" className="gap-2">
                  <Radio className="w-4 h-4" />
                  Live
                </TabsTrigger>
                <TabsTrigger value="autopilot" className="gap-2">
                  <Bot className="w-4 h-4" />
                  Autopilot
                </TabsTrigger>
              </TabsList>
            </Tabs>

            {scoutMode === 'upload' && (
              <>
                {/* Clip Category Selector */}
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

                {/* Main Content Tabs */}
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

            {scoutMode === 'live' && (
              <div className="space-y-4">
                <ScoutLiveCapture
                  gameContext={selectedGame}
                  onObservationsUpdate={handleLiveObservationsUpdate}
                  onHalftimeAnalysis={handleLiveAnalysisComplete}
                />
                
                {/* Show results after halftime analysis */}
                {analysisResult && (
                  <ScoutAnalysisResults
                    result={analysisResult}
                    frames={extractedFrames}
                    gameContext={selectedGame}
                  />
                )}
              </div>
            )}

            {scoutMode === 'autopilot' && (
              <ScoutAutonomousAgent gameContext={selectedGame} />
            )}
          </>
        )}

        {/* Info Section */}
        {!selectedGame && (
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
