import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { 
  User, 
  TrendingUp, 
  TrendingDown, 
  Minus, 
  Eye, 
  Zap, 
  Activity,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  CheckCircle,
  XCircle
} from "lucide-react";
import type { AnalysisResult, PlayerObservation, PropRecommendation, GameContext } from "@/pages/Scout";

interface ScoutAnalysisResultsProps {
  result: AnalysisResult;
  frames: string[];
  gameContext: GameContext;
}

export function ScoutAnalysisResults({ result, frames, gameContext }: ScoutAnalysisResultsProps) {
  const [expandedPlayer, setExpandedPlayer] = useState<string | null>(null);
  const [selectedFrameIndex, setSelectedFrameIndex] = useState<number | null>(null);

  const getRecommendationIcon = (rec: "OVER" | "UNDER" | "PASS") => {
    switch (rec) {
      case "OVER": return <TrendingUp className="w-4 h-4 text-green-500" />;
      case "UNDER": return <TrendingDown className="w-4 h-4 text-red-500" />;
      case "PASS": return <Minus className="w-4 h-4 text-yellow-500" />;
    }
  };

  const getRecommendationColor = (rec: "OVER" | "UNDER" | "PASS") => {
    switch (rec) {
      case "OVER": return "bg-green-500/10 text-green-500 border-green-500/20";
      case "UNDER": return "bg-red-500/10 text-red-500 border-red-500/20";
      case "PASS": return "bg-yellow-500/10 text-yellow-500 border-yellow-500/20";
    }
  };

  const getConfidenceColor = (conf: "low" | "medium" | "high") => {
    switch (conf) {
      case "high": return "text-green-500";
      case "medium": return "text-yellow-500";
      case "low": return "text-muted-foreground";
    }
  };

  const getMovementScoreColor = (score: number) => {
    if (score >= 8) return "bg-green-500";
    if (score >= 6) return "bg-yellow-500";
    if (score >= 4) return "bg-orange-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-4">
      {/* Summary */}
      <Card className="border-primary/20 bg-primary/5">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Eye className="w-4 h-4 text-primary" />
            Analysis Summary
          </CardTitle>
          <CardDescription>
            {gameContext.awayTeam} @ {gameContext.homeTeam}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-background rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Players Detected</p>
              <p className="text-2xl font-bold">{result.observations.length}</p>
            </div>
            <div className="p-3 bg-background rounded-lg">
              <p className="text-xs text-muted-foreground mb-1">Betting Signals</p>
              <p className="text-2xl font-bold">{result.recommendations.length}</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <Badge variant="outline" className="bg-chart-3/10 text-chart-3 border-chart-3/20">
              <Activity className="w-3 h-3 mr-1" />
              Pace: {result.paceAssessment}
            </Badge>
          </div>

          {result.bettingSignals.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Key Signals:</p>
              <ul className="text-sm space-y-1">
                {result.bettingSignals.slice(0, 3).map((signal, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Zap className="w-3 h-3 text-primary mt-1 shrink-0" />
                    {signal}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recommendations */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-green-500" />
            Prop Recommendations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {result.recommendations.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground">
              <AlertTriangle className="w-8 h-8 mx-auto mb-2 opacity-50" />
              <p>No actionable recommendations from this footage</p>
              <p className="text-xs mt-1">Try uploading more clips</p>
            </div>
          ) : (
            result.recommendations.map((rec, i) => (
              <div 
                key={i} 
                className={`p-4 rounded-lg border ${getRecommendationColor(rec.recommendation)}`}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {getRecommendationIcon(rec.recommendation)}
                    <span className="font-semibold">{rec.recommendation}</span>
                  </div>
                  <Badge variant="outline" className={getConfidenceColor(rec.confidence)}>
                    {rec.confidence}
                  </Badge>
                </div>
                
                <p className="font-medium mb-1">
                  {rec.playerName} - {rec.propType} {rec.line}
                </p>
                
                <p className="text-sm text-muted-foreground mb-2">
                  {rec.reasoning}
                </p>
                
                {rec.visualEvidence.length > 0 && (
                  <div className="text-xs space-y-1">
                    <p className="text-muted-foreground font-medium">Visual Evidence:</p>
                    {rec.visualEvidence.map((evidence, j) => (
                      <div key={j} className="flex items-start gap-2">
                        <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" />
                        {evidence}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {/* Player Observations */}
      <Card className="border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="w-4 h-4 text-chart-4" />
            Player Observations
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {result.observations.map((obs, i) => {
            const isExpanded = expandedPlayer === obs.playerName;
            
            return (
              <div 
                key={i} 
                className="border rounded-lg overflow-hidden"
              >
                <Button
                  variant="ghost"
                  className="w-full justify-between h-auto py-3 px-4"
                  onClick={() => setExpandedPlayer(isExpanded ? null : obs.playerName)}
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="font-mono">
                      #{obs.jerseyNumber}
                    </Badge>
                    <div className="text-left">
                      <p className="font-medium">{obs.playerName}</p>
                      <p className="text-xs text-muted-foreground">{obs.team}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">Movement</p>
                      <div className="flex items-center gap-1">
                        <div className={`w-2 h-2 rounded-full ${getMovementScoreColor(obs.movementScore)}`} />
                        <span className="font-mono font-bold">{obs.movementScore}/10</span>
                      </div>
                    </div>
                    {isExpanded ? (
                      <ChevronUp className="w-4 h-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="w-4 h-4 text-muted-foreground" />
                    )}
                  </div>
                </Button>
                
                {isExpanded && (
                  <div className="px-4 pb-4 space-y-3">
                    <Separator />
                    
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Body Language</p>
                        <p>{obs.bodyLanguage}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Confidence</p>
                        <Badge variant="outline" className={getConfidenceColor(obs.confidence)}>
                          {obs.confidence}
                        </Badge>
                      </div>
                    </div>
                    
                    {obs.fatigueIndicators.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Fatigue Indicators</p>
                        <div className="flex flex-wrap gap-1">
                          {obs.fatigueIndicators.map((indicator, j) => (
                            <Badge key={j} variant="secondary" className="text-xs">
                              {indicator}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}
                    
                    {obs.shotMechanicsNote && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Shot Mechanics</p>
                        <p className="text-sm">{obs.shotMechanicsNote}</p>
                      </div>
                    )}
                    
                    {obs.framesDetectedIn.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">
                          Detected in {obs.framesDetectedIn.length} frames
                        </p>
                        <div className="flex gap-1 overflow-x-auto pb-1">
                          {obs.framesDetectedIn.slice(0, 4).map((frameIdx) => (
                            <button
                              key={frameIdx}
                              onClick={() => setSelectedFrameIndex(frameIdx)}
                              className={`
                                w-16 h-10 rounded overflow-hidden shrink-0 border-2
                                ${selectedFrameIndex === frameIdx ? 'border-primary' : 'border-transparent'}
                              `}
                            >
                              {frames[frameIdx] && (
                                <img 
                                  src={frames[frameIdx]} 
                                  alt={`Frame ${frameIdx}`}
                                  className="w-full h-full object-cover"
                                />
                              )}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Team Analysis */}
      {result.teamObservations && Object.keys(result.teamObservations).length > 0 && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-chart-2" />
              Team Analysis
            </CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            {Object.entries(result.teamObservations).map(([team, data]) => (
              <div key={team} className="p-3 bg-muted/50 rounded-lg space-y-2">
                <p className="font-medium text-sm">{team}</p>
                <div className="space-y-1 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Defense</span>
                    <span>{data.defensiveIntensity}/10</span>
                  </div>
                  <Progress value={data.defensiveIntensity * 10} className="h-1" />
                </div>
                <div className="flex flex-wrap gap-1">
                  <Badge variant="outline" className="text-xs">
                    {data.pace}
                  </Badge>
                  <Badge variant="outline" className="text-xs">
                    {data.energyTrend}
                  </Badge>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Frame Viewer */}
      {selectedFrameIndex !== null && frames[selectedFrameIndex] && (
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Frame Evidence</CardTitle>
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => setSelectedFrameIndex(null)}
              >
                <XCircle className="w-4 h-4" />
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg overflow-hidden">
              <img 
                src={frames[selectedFrameIndex]} 
                alt={`Frame ${selectedFrameIndex}`}
                className="w-full"
              />
            </div>
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Frame {selectedFrameIndex + 1} of {frames.length}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
