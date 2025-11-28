import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Plus, Upload as UploadIcon, Flame, X, Loader2, Sparkles, CheckCircle2, Clock, Pencil, CalendarIcon } from "lucide-react";
import { createLeg, simulateParlay, americanToDecimal } from "@/lib/parlay-calculator";
import { ParlayLeg } from "@/types/parlay";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

// Calculate estimated per-leg odds when we only have total odds
function calculateEstimatedLegOdds(totalOdds: number, numLegs: number): number {
  const totalDecimal = americanToDecimal(totalOdds);
  const perLegDecimal = Math.pow(totalDecimal, 1 / numLegs);
  
  // Convert back to American odds
  if (perLegDecimal >= 2) {
    return Math.round((perLegDecimal - 1) * 100);
  } else {
    return Math.round(-100 / (perLegDecimal - 1));
  }
}
interface LegInput {
  id: string;
  description: string;
  odds: string;
}

const Upload = () => {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [legs, setLegs] = useState<LegInput[]>([
    { id: crypto.randomUUID(), description: "", odds: "" },
    { id: crypto.randomUUID(), description: "", odds: "" },
  ]);
  const [stake, setStake] = useState("10");
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedTotalOdds, setExtractedTotalOdds] = useState<number | null>(null);
  const [extractedGameTime, setExtractedGameTime] = useState<string | null>(null);
  const [isEditingGameTime, setIsEditingGameTime] = useState(false);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editTime, setEditTime] = useState("19:00");

  // Parse extracted game time to Date for editing
  const parseGameTimeForEdit = useCallback((gameTime: string) => {
    try {
      const parsed = new Date(gameTime);
      if (!isNaN(parsed.getTime())) {
        setEditDate(parsed);
        setEditTime(format(parsed, "HH:mm"));
      } else {
        // Default to today at 7pm if parsing fails
        setEditDate(new Date());
        setEditTime("19:00");
      }
    } catch {
      setEditDate(new Date());
      setEditTime("19:00");
    }
  }, []);

  const handleEditGameTime = () => {
    if (extractedGameTime) {
      parseGameTimeForEdit(extractedGameTime);
    } else {
      setEditDate(new Date());
      setEditTime("19:00");
    }
    setIsEditingGameTime(true);
  };

  const handleSaveGameTime = () => {
    if (editDate) {
      const [hours, minutes] = editTime.split(':').map(Number);
      const newDate = new Date(editDate);
      newDate.setHours(hours, minutes, 0, 0);
      setExtractedGameTime(format(newDate, "MMM d, yyyy h:mm a"));
    }
    setIsEditingGameTime(false);
  };

  const handleAddGameTimeManually = () => {
    setEditDate(new Date());
    setEditTime("19:00");
    setIsEditingGameTime(true);
  };

  const addLeg = () => {
    if (legs.length >= 15) {
      toast({
        title: "Whoa there, degen! 🎰",
        description: "15 legs is plenty. Even Vegas thinks you're crazy.",
        variant: "destructive",
      });
      return;
    }
    setLegs([...legs, { id: crypto.randomUUID(), description: "", odds: "" }]);
  };

  const removeLeg = (id: string) => {
    if (legs.length <= 2) {
      toast({
        title: "Can't do that! 🙅",
        description: "You need at least 2 legs for a parlay.",
      });
      return;
    }
    setLegs(legs.filter((leg) => leg.id !== id));
  };

  const updateLeg = (id: string, field: 'description' | 'odds', value: string) => {
    setLegs(legs.map((leg) => 
      leg.id === id ? { ...leg, [field]: value } : leg
    ));
    // Clear extracted total odds when user manually edits legs
    if (field === 'odds') {
      setExtractedTotalOdds(null);
    }
  };

  const convertFileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  };

  const handleFileSelect = useCallback(async (file: File) => {
    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        title: "Wrong file type! 📁",
        description: "Please upload an image of your betting slip.",
        variant: "destructive",
      });
      return;
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too big! 📦",
        description: "Max file size is 10MB.",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    
    toast({
      title: "Scanning your slip... 🔍",
      description: "AI is reading your betting slip.",
    });

    try {
      // Convert file to base64
      const imageBase64 = await convertFileToBase64(file);

      // Call the edge function
      const { data, error } = await supabase.functions.invoke('extract-parlay', {
        body: { imageBase64 }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Failed to process image');
      }

      if (data?.error) {
        throw new Error(data.error);
      }

      const extractedLegs = data?.legs || [];
      const extractedTotalOddsStr = data?.totalOdds;
      const extractedStake = data?.stake;
      const extractedEarliestGameTime = data?.earliestGameTime;

      if (extractedLegs.length === 0) {
        toast({
          title: "No legs found 🤔",
          description: "Couldn't read your slip. Try a clearer image or enter manually.",
          variant: "destructive",
        });
        return;
      }

      // Convert extracted legs to LegInput format
      const newLegs: LegInput[] = extractedLegs.map((leg: { description: string; odds: string }) => ({
        id: crypto.randomUUID(),
        description: leg.description || "",
        odds: leg.odds?.replace('+', '') || "", // Remove + prefix, we'll handle display
      }));

      // Ensure we have at least 2 legs
      while (newLegs.length < 2) {
        newLegs.push({ id: crypto.randomUUID(), description: "", odds: "" });
      }

      setLegs(newLegs);

      // Parse and store extracted total odds
      if (extractedTotalOddsStr) {
        const parsedOdds = parseInt(extractedTotalOddsStr.replace('+', ''));
        if (!isNaN(parsedOdds) && parsedOdds !== 0) {
          setExtractedTotalOdds(parsedOdds);
          console.log('Extracted total parlay odds:', parsedOdds);
        }
      } else {
        setExtractedTotalOdds(null);
      }

      // Pre-populate stake if extracted
      if (extractedStake) {
        const stakeNum = parseFloat(extractedStake.replace(/[$,]/g, ''));
        if (!isNaN(stakeNum) && stakeNum > 0) {
          setStake(stakeNum.toString());
        }
      }

      // Store extracted game time
      if (extractedEarliestGameTime) {
        setExtractedGameTime(extractedEarliestGameTime);
        console.log('Extracted game time:', extractedEarliestGameTime);
      } else {
        setExtractedGameTime(null);
      }

      const oddsInfo = extractedTotalOddsStr ? ` Total odds: ${extractedTotalOddsStr}` : '';
      const timeInfo = extractedEarliestGameTime ? ` Game time: ${extractedEarliestGameTime}` : '';
      toast({
        title: `Found ${extractedLegs.length} legs! 🎯`,
        description: `Your parlay has been loaded.${oddsInfo}${timeInfo} Review and run simulation!`,
      });

    } catch (error) {
      console.error('OCR error:', error);
      toast({
        title: "Scan failed 😵",
        description: error instanceof Error ? error.message : "Try again or enter manually.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  }, [handleFileSelect]);

  const triggerFileInput = useCallback(() => {
    if (!isProcessing) {
      fileInputRef.current?.click();
    }
  }, [isProcessing]);

  const handleSimulate = () => {
    // Validate inputs
    const validLegs: ParlayLeg[] = [];
    
    for (const leg of legs) {
      if (!leg.description.trim()) {
        toast({
          title: "Missing description! 📝",
          description: "Give each leg a name, degen.",
          variant: "destructive",
        });
        return;
      }
      
      // When we have extractedTotalOdds, individual odds are optional
      if (extractedTotalOdds !== null) {
        const oddsNum = leg.odds ? parseInt(leg.odds) : calculateEstimatedLegOdds(extractedTotalOdds, legs.length);
        // Only validate if user entered something
        if (leg.odds && (isNaN(oddsNum) || oddsNum === 0 || (oddsNum > -100 && oddsNum < 100))) {
          toast({
            title: "Invalid odds! 🎲",
            description: "Use American odds like +150 or -110",
            variant: "destructive",
          });
          return;
        }
        validLegs.push(createLeg(leg.description, oddsNum));
      } else {
        // Standard validation when no total odds extracted
        const oddsNum = parseInt(leg.odds);
        if (isNaN(oddsNum) || oddsNum === 0 || (oddsNum > -100 && oddsNum < 100)) {
          toast({
            title: "Invalid odds! 🎲",
            description: "Use American odds like +150 or -110",
            variant: "destructive",
          });
          return;
        }
        validLegs.push(createLeg(leg.description, oddsNum));
      }
    }

    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      toast({
        title: "Invalid stake! 💸",
        description: "How much are you putting on this?",
        variant: "destructive",
      });
      return;
    }

    // Run simulation - use extracted total odds if available
    const simulation = simulateParlay(validLegs, stakeNum, extractedTotalOdds ?? undefined);
    
    // Clear extracted data after use
    const gameTimeToPass = extractedGameTime;
    setExtractedTotalOdds(null);
    setExtractedGameTime(null);
    
    // Navigate to results with simulation data and extracted game time
    navigate('/results', { state: { simulation, extractedGameTime: gameTimeToPass } });
  };

  return (
    <div className="min-h-screen bg-background pb-32 touch-pan-y">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      <main className="max-w-lg mx-auto px-3 py-4">
        {/* Header */}
        <div className="text-center mb-5">
          <h1 className="font-display text-3xl text-gradient-fire mb-1">
            🎟️ ENTER YOUR SLIP
          </h1>
          <p className="text-muted-foreground text-sm">
            Add your legs and prepare for judgment.
          </p>
        </div>

        {/* Drop Zone - Now with AI OCR */}
        <FeedCard 
          variant="full-bleed"
          className={`mb-5 transition-all duration-200 ${
            isProcessing 
              ? 'border-2 border-neon-purple border-dashed cursor-wait' 
              : 'cursor-pointer active:scale-[0.98]'
          } ${
            isDragging 
              ? 'border-2 border-neon-green border-dashed scale-[1.02]' 
              : !isProcessing ? 'border border-dashed border-border' : ''
          }`}
          onDrop={!isProcessing ? handleDrop : undefined}
          onDragOver={!isProcessing ? handleDragOver : undefined}
          onDragLeave={!isProcessing ? handleDragLeave : undefined}
          onClick={triggerFileInput}
        >
          <div className="text-center py-6">
            {isProcessing ? (
              <>
                <div className="w-14 h-14 rounded-full gradient-purple mx-auto mb-3 flex items-center justify-center">
                  <Loader2 className="w-7 h-7 text-foreground animate-spin" />
                </div>
                <p className="font-semibold text-foreground mb-1">
                  AI Scanning Your Slip...
                </p>
                <p className="text-sm text-muted-foreground">
                  Extracting your parlay legs
                </p>
              </>
            ) : (
              <>
                <div className="w-14 h-14 rounded-full gradient-neon mx-auto mb-3 flex items-center justify-center">
                  <UploadIcon className="w-7 h-7 text-background" />
                </div>
                <p className="font-semibold text-foreground mb-1 flex items-center justify-center gap-2">
                  <Sparkles className="w-4 h-4 text-neon-purple" />
                  AI-Powered Slip Scanner
                  <Sparkles className="w-4 h-4 text-neon-purple" />
                </p>
                <p className="text-sm text-muted-foreground mb-3">
                  Upload a photo and we'll extract your legs automatically
                </p>
                <Button 
                  variant="muted" 
                  size="default"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerFileInput();
                  }}
                >
                  Browse Files
                </Button>
              </>
            )}
          </div>
        </FeedCard>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-xs">or enter manually</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Extracted Data Banners */}
        <div className="space-y-2 mb-4">
          {/* Extracted Total Odds Banner */}
          {extractedTotalOdds && (
            <div className="bg-neon-green/10 border border-neon-green/30 rounded-xl p-3 flex items-center justify-between slide-up">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-neon-green" />
                <div>
                  <p className="text-xs text-muted-foreground">Total Parlay Odds (from slip)</p>
                  <p className="text-lg font-bold text-neon-green">
                    {extractedTotalOdds > 0 ? '+' : ''}{extractedTotalOdds}
                  </p>
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setExtractedTotalOdds(null)}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Extracted Game Time Banner or Add Button */}
          {extractedGameTime ? (
            <div className="bg-neon-purple/10 border border-neon-purple/30 rounded-xl p-3 slide-up">
              {isEditingGameTime ? (
                <div className="space-y-3">
                  <p className="text-xs text-muted-foreground">Edit Game Start Time</p>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className={cn(
                            "justify-start text-left font-normal flex-1",
                            !editDate && "text-muted-foreground"
                          )}
                        >
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {editDate ? format(editDate, "MMM d, yyyy") : <span>Pick date</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={editDate}
                          onSelect={setEditDate}
                          initialFocus
                          className={cn("p-3 pointer-events-auto")}
                        />
                      </PopoverContent>
                    </Popover>
                    <Input
                      type="time"
                      value={editTime}
                      onChange={(e) => setEditTime(e.target.value)}
                      className="w-32"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleSaveGameTime} className="flex-1">
                      Save
                    </Button>
                    <Button 
                      size="sm" 
                      variant="ghost" 
                      onClick={() => setIsEditingGameTime(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Clock className="w-5 h-5 text-neon-purple" />
                    <div>
                      <p className="text-xs text-muted-foreground">First Game Starts</p>
                      <p className="text-base font-bold text-neon-purple">
                        {extractedGameTime}
                      </p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={handleEditGameTime}
                      className="text-muted-foreground hover:text-neon-purple"
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button 
                      variant="ghost" 
                      size="sm" 
                      onClick={() => setExtractedGameTime(null)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <X className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={handleAddGameTimeManually}
              className="w-full border-dashed border-neon-purple/30 text-muted-foreground hover:text-neon-purple hover:border-neon-purple/50"
            >
              <Clock className="w-4 h-4 mr-2" />
              Add Game Start Time (optional)
            </Button>
          )}
        </div>

        {/* Legs Table */}
        <FeedCard variant="full-bleed" className="mb-5">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
            📋 Your Legs ({legs.length})
          </p>
          
          <div className="space-y-2">
            {legs.map((leg, idx) => (
              <div 
                key={leg.id} 
                className="flex gap-2 items-center slide-up" 
                style={{ animationDelay: `${idx * 30}ms` }}
              >
                <span className="text-muted-foreground font-bold w-7 text-center shrink-0 text-sm">
                  #{idx + 1}
                </span>
                <Input
                  placeholder="e.g. Lakers ML"
                  value={leg.description}
                  onChange={(e) => updateLeg(leg.id, 'description', e.target.value)}
                  className="flex-1"
                />
                <Input
                  placeholder={extractedTotalOdds ? "Auto" : "+150"}
                  value={leg.odds}
                  onChange={(e) => updateLeg(leg.id, 'odds', e.target.value)}
                  className={`w-20 text-center ${!leg.odds && extractedTotalOdds ? 'text-muted-foreground italic' : ''}`}
                  inputMode="numeric"
                />
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => removeLeg(leg.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive min-w-[44px] min-h-[44px]"
                >
                  <X className="w-5 h-5" />
                </Button>
              </div>
            ))}
          </div>

          <Button 
            variant="muted" 
            className="w-full mt-3"
            onClick={addLeg}
          >
            <Plus className="w-5 h-5" />
            Add Leg
          </Button>
        </FeedCard>

        {/* Stake Input */}
        <FeedCard variant="full-bleed" className="mb-5">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-2">
            💰 Your Stake
          </p>
          <div className="flex items-center gap-2">
            <span className="text-2xl text-muted-foreground">$</span>
            <Input
              type="text"
              inputMode="decimal"
              placeholder="10.00"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="text-2xl font-bold text-center"
            />
          </div>
        </FeedCard>
      </main>

      {/* Sticky CTA */}
      <div className="fixed bottom-20 left-0 right-0 p-3 bg-gradient-to-t from-background via-background to-transparent">
        <div className="max-w-lg mx-auto">
          <Button 
            variant="fire" 
            size="xl" 
            className="w-full font-display text-xl tracking-wider shadow-lg shadow-primary/30"
            onClick={handleSimulate}
            disabled={isProcessing}
          >
            <Flame className="w-6 h-6" />
            RUN SIMULATION 🔥
          </Button>
        </div>
      </div>

      <BottomNav />
    </div>
  );
};

export default Upload;
