import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PaywallModal } from "@/components/PaywallModal";
import { QuickCheckResults } from "@/components/upload/QuickCheckResults";
import { Plus, Upload as UploadIcon, Flame, X, Loader2, Sparkles, CheckCircle2, Clock, Pencil, CalendarIcon, Crown, Image, Shield } from "lucide-react";
import { Progress } from "@/components/ui/progress";
import { createLeg, simulateParlay, americanToDecimal } from "@/lib/parlay-calculator";
import { ParlayLeg } from "@/types/parlay";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";
import { useAuth } from "@/contexts/AuthContext";
import { compressImage, validateImageFile } from "@/lib/image-compression";

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

interface QueuedSlip {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  extractedLegs?: { description: string; odds: string }[];
  extractedTotalOdds?: number;
  extractedStake?: string;
  extractedGameTime?: string;
  error?: string;
}

const Upload = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { isSubscribed, isAdmin, canScan, scansRemaining, incrementScan, startCheckout, checkSubscription } = useSubscription();
  
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
  const [showPaywall, setShowPaywall] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<QueuedSlip[]>([]);
  const [processingIndex, setProcessingIndex] = useState<number>(-1);
  const [isQuickChecking, setIsQuickChecking] = useState(false);
  const [quickCheckResults, setQuickCheckResults] = useState<any>(null);

  // Check for success/cancel params from Stripe checkout
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      toast({
        title: "Welcome to Pro! 🎉",
        description: "You now have unlimited parlay scans.",
      });
      checkSubscription();
    } else if (searchParams.get('canceled') === 'true') {
      toast({
        title: "Checkout canceled",
        description: "No worries, you can upgrade anytime.",
      });
    }
  }, [searchParams, checkSubscription]);

  // Handle optimized legs from Results page
  useEffect(() => {
    const optimizedData = location.state as { 
      optimizedLegs?: Array<{ id: string; description: string; odds: string }>;
      optimizationApplied?: boolean;
      removedCount?: number;
    } | null;

    if (optimizedData?.optimizedLegs && optimizedData.optimizationApplied) {
      // Pre-fill with optimized legs
      setLegs(optimizedData.optimizedLegs);
      
      // Show success toast
      toast({
        title: "✨ Parlay Optimized!",
        description: `Removed ${optimizedData.removedCount} problematic leg${optimizedData.removedCount !== 1 ? 's' : ''}. Review and analyze your improved parlay.`,
      });
      
      // Clear navigation state
      navigate('/upload', { replace: true, state: null });
    }
  }, [location.state, navigate]);

  // Parse extracted game time to Date for editing
  const parseGameTimeForEdit = useCallback((gameTime: string) => {
    try {
      const parsed = new Date(gameTime);
      if (!isNaN(parsed.getTime())) {
        setEditDate(parsed);
        setEditTime(format(parsed, "HH:mm"));
      } else {
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

  const handleQuickCheck = async () => {
    // Validate that we have at least 2 legs with descriptions
    const validLegs = legs.filter(leg => leg.description.trim());
    
    if (validLegs.length < 2) {
      toast({
        title: "Need more legs! 🎲",
        description: "Add at least 2 legs with descriptions to run Quick Check.",
      });
      return;
    }

    setIsQuickChecking(true);
    setQuickCheckResults(null);

    try {
      const { data, error } = await supabase.functions.invoke('quick-sharp-check', {
        body: { 
          legs: validLegs.map(leg => ({ description: leg.description }))
        }
      });

      if (error) throw error;
      
      setQuickCheckResults(data);
      
      // Show toast based on results
      if (data.hasSharpConflicts) {
        toast({
          title: "⚠️ Sharp Conflicts Detected",
          description: data.suggestedAction,
          variant: "destructive",
        });
      } else if (data.overallRisk === 'caution') {
        toast({
          title: "🟡 Proceed with Caution",
          description: data.suggestedAction,
        });
      } else {
        toast({
          title: "🟢 Looking Good!",
          description: data.suggestedAction,
        });
      }
    } catch (error) {
      console.error('Quick check error:', error);
      toast({
        title: "Quick Check Failed",
        description: "Unable to fetch sharp data. Try again later.",
        variant: "destructive",
      });
    } finally {
      setIsQuickChecking(false);
    }
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

  const handleFilesSelected = useCallback(async (files: File[]) => {
    // Check scan access for logged-in users
    if (user && !canScan && !isSubscribed && !isAdmin) {
      setShowPaywall(true);
      return;
    }

    // Validate and queue files
    const newQueue: QueuedSlip[] = files
      .filter(file => {
        const validation = validateImageFile(file);
        if (!validation.valid) {
          toast({
            title: "Invalid file skipped",
            description: validation.error,
            variant: "destructive",
          });
          return false;
        }
        return true;
      })
      .slice(0, 10) // Max 10 files at once
      .map(file => ({
        id: crypto.randomUUID(),
        file,
        preview: URL.createObjectURL(file),
        status: 'pending' as const,
      }));

    if (newQueue.length === 0) {
      toast({ title: "No valid images", variant: "destructive" });
      return;
    }

    setUploadQueue(newQueue);
    setIsProcessing(true);

    // Process queue sequentially
    const allExtractedLegs: LegInput[] = [];
    let lastGameTime: string | null = null;
    let lastTotalOdds: number | null = null;
    let lastStake: string | null = null;
    let successCount = 0;

    for (let i = 0; i < newQueue.length; i++) {
      setProcessingIndex(i);
      
      // Update status to processing
      setUploadQueue(prev => prev.map((item, idx) => 
        idx === i ? { ...item, status: 'processing' } : item
      ));

      try {
        const { base64 } = await compressImage(newQueue[i].file);
        const { data, error } = await supabase.functions.invoke('extract-parlay', {
          body: { imageBase64: base64 }
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        const extractedLegs = data?.legs || [];
        
        // Add extracted legs to combined list
        extractedLegs.forEach((leg: any) => {
          allExtractedLegs.push({
            id: crypto.randomUUID(),
            description: leg.description || "",
            odds: leg.odds?.replace('+', '') || "",
          });
        });

        // Store data from last successful extraction
        if (data?.totalOdds) lastTotalOdds = parseInt(data.totalOdds.replace('+', ''));
        if (data?.earliestGameTime) lastGameTime = data.earliestGameTime;
        if (data?.stake) lastStake = data.stake;

        // Update status to success
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: 'success', extractedLegs } : item
        ));

        successCount++;

        // Increment scan for free users
        if (user && !isSubscribed && !isAdmin) await incrementScan();

      } catch (err) {
        setUploadQueue(prev => prev.map((item, idx) => 
          idx === i ? { ...item, status: 'error', error: String(err) } : item
        ));
      }

      // Small delay between files to avoid rate limiting
      if (i < newQueue.length - 1) await new Promise(r => setTimeout(r, 1000));
    }

    // Set combined legs from all slips
    if (allExtractedLegs.length > 0) {
      setLegs(allExtractedLegs.length >= 2 ? allExtractedLegs : 
        [...allExtractedLegs, { id: crypto.randomUUID(), description: "", odds: "" }]);
    }
    
    if (lastTotalOdds) setExtractedTotalOdds(lastTotalOdds);
    if (lastGameTime) setExtractedGameTime(lastGameTime);
    if (lastStake) setStake(lastStake.replace(/[$,]/g, ''));

    setIsProcessing(false);
    setProcessingIndex(-1);

    if (successCount > 0) {
      toast({
        title: `Extracted ${allExtractedLegs.length} total legs! 🎯`,
        description: `From ${successCount} slip${successCount > 1 ? 's' : ''}`,
      });
    }
  }, [user, canScan, isSubscribed, isAdmin, incrementScan, startCheckout, scansRemaining]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFilesSelected(Array.from(files));
    }
  }, [handleFilesSelected]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleFileInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFilesSelected(Array.from(files));
    }
    // Reset input so same file can be selected again
    e.target.value = '';
  }, [handleFilesSelected]);

  const triggerFileInput = useCallback(() => {
    if (!isProcessing) {
      // Check scan access before opening file picker
      if (user && !canScan && !isSubscribed && !isAdmin) {
        setShowPaywall(true);
        return;
      }
      fileInputRef.current?.click();
    }
  }, [isProcessing, user, canScan, isSubscribed, isAdmin]);

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
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        onChange={handleFileInputChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Paywall Modal */}
      <PaywallModal
        isOpen={showPaywall}
        onClose={() => setShowPaywall(false)}
        onSubscribe={startCheckout}
        scansUsed={3 - scansRemaining}
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

        {/* Scan Counter / Pro Badge */}
        {user && (
          <div className="flex justify-center items-center gap-2 mb-4">
            {isSubscribed || isAdmin ? (
              <Badge className="bg-primary/20 text-primary border-primary/30 gap-1">
                <Crown className="w-3 h-3" />
                {isAdmin ? 'ADMIN' : 'PRO'} - Unlimited Scans
              </Badge>
            ) : (
              <>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "gap-1",
                    scansRemaining === 0 && "border-destructive/50 text-destructive"
                  )}
                >
                  {scansRemaining}/3 Free Scans
                </Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={startCheckout}
                  className="text-primary hover:text-primary/80 hover:bg-primary/10"
                >
                  <Crown className="w-4 h-4 mr-1" />
                  Upgrade
                </Button>
              </>
            )}
          </div>
        )}

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
                  Upload photos and we'll extract your legs automatically
                  <br />
                  <span className="text-xs opacity-70">Supports multiple slips at once!</span>
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

            {/* Queue Progress */}
            {uploadQueue.length > 0 && isProcessing && (
              <div className="mt-4 space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <span>Processing {processingIndex + 1} of {uploadQueue.length}</span>
                  <span>{uploadQueue.filter(q => q.status === 'success').length} completed</span>
                </div>
                <Progress value={((processingIndex + 1) / uploadQueue.length) * 100} />
                <div className="grid grid-cols-5 gap-2">
                  {uploadQueue.map((item) => (
                    <div key={item.id} className="relative aspect-square rounded overflow-hidden border border-border">
                      <img src={item.preview} alt="Slip" className="w-full h-full object-cover" />
                      <div className={cn(
                        "absolute inset-0 flex items-center justify-center",
                        item.status === 'processing' && "bg-background/80",
                        item.status === 'success' && "bg-green-500/20",
                        item.status === 'error' && "bg-red-500/20",
                        item.status === 'pending' && "bg-background/50"
                      )}>
                        {item.status === 'processing' && <Loader2 className="w-5 h-5 animate-spin" />}
                        {item.status === 'success' && <CheckCircle2 className="w-5 h-5 text-green-500" />}
                        {item.status === 'error' && <X className="w-5 h-5 text-red-500" />}
                        {item.status === 'pending' && <Image className="w-5 h-5 text-muted-foreground" />}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
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

        {/* Quick Check Button & Results */}
        {legs.filter(l => l.description.trim()).length >= 2 && (
          <div className="mb-5 space-y-3">
            <Button
              variant="outline"
              size="lg"
              className="w-full border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
              onClick={handleQuickCheck}
              disabled={isQuickChecking}
            >
              {isQuickChecking ? (
                <>
                  <Loader2 className="w-5 h-5 mr-2 animate-spin" />
                  Checking Sharp Data...
                </>
              ) : (
                <>
                  <Shield className="w-5 h-5 mr-2" />
                  ⚡ Quick Sharp Check
                </>
              )}
            </Button>
            
            {quickCheckResults && (
              <QuickCheckResults results={quickCheckResults} />
            )}
          </div>
        )}
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
