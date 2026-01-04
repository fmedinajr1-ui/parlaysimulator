import { useState, useCallback, useRef, useEffect } from "react";
import { useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { format } from "date-fns";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { PaywallModal } from "@/components/PaywallModal";
import { PilotPaywallModal } from "@/components/PilotPaywallModal";
import { LowScansPopup } from "@/components/LowScansPopup";
import { QuickCheckResults } from "@/components/upload/QuickCheckResults";
import { UploadOptimizer } from "@/components/upload/UploadOptimizer";
import { ExtractionQueueBanner } from "@/components/upload/ExtractionQueueBanner";
import { MobileHeader } from "@/components/layout/MobileHeader";
import { Plus, Upload as UploadIcon, Flame, X, Loader2, Sparkles, CheckCircle2, Clock, Pencil, CalendarIcon, Crown, Image, Shield, HelpCircle, Home, Video, Trash2 } from "lucide-react";
import { HintTooltip } from "@/components/tutorial/HintTooltip";
import { useHints } from "@/hooks/useHints";
import { Progress } from "@/components/ui/progress";
import { createLeg, simulateParlay, americanToDecimal } from "@/lib/parlay-calculator";
import { ParlayLeg } from "@/types/parlay";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useSubscription } from "@/hooks/useSubscription";
import { usePilotUser } from "@/hooks/usePilotUser";
import { useLowScansPopup } from "@/hooks/useLowScansPopup";
import { useAuth } from "@/contexts/AuthContext";
import { compressImage, validateMediaFile } from "@/lib/image-compression";
import { extractFramesFromVideo, isVideoFile, type ExtractionProgress } from "@/lib/video-frame-extractor";
import { ClearerScreenshotNudge } from "@/components/upload/ClearerScreenshotNudge";
import { useHapticFeedback } from "@/hooks/useHapticFeedback";
import { usePersistedState } from "@/hooks/usePersistedState";
import { useExtractionQueue, type QueuedExtraction } from "@/hooks/useExtractionQueue";

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
  // PrizePicks-specific
  platform?: 'fanduel' | 'draftkings' | 'betmgm' | 'prizepicks' | 'underdog' | 'other';
  playType?: 'power_play' | 'flex_play' | 'parlay' | 'sgp';
  payoutMultiplier?: number;
}

const Upload = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { isSubscribed, isAdmin, canScan, scansRemaining, incrementScan, startCheckout, checkSubscription } = useSubscription();
  const { isPilotUser, canScan: pilotCanScan, totalScansAvailable, decrementScan, purchaseScans, checkStatus: checkPilotStatus, isPurchasing: isPilotPurchasing } = usePilotUser();
  const { shouldShowHint, dismissHint } = useHints();
  const haptics = useHapticFeedback();
  const lowScansPopup = useLowScansPopup();
  
  // Persisted state for Safari PWA backgrounding (30 minute TTL)
  const UPLOAD_STATE_KEY = 'upload-page-state';
  const [persistedData, setPersistedData, clearPersistedData] = usePersistedState<{
    legs: LegInput[];
    stake: string;
    extractedTotalOdds: number | null;
    extractedGameTime: string | null;
    wasRestored?: boolean;
  }>(UPLOAD_STATE_KEY, {
    legs: [
      { id: crypto.randomUUID(), description: "", odds: "" },
      { id: crypto.randomUUID(), description: "", odds: "" },
    ],
    stake: "10",
    extractedTotalOdds: null,
    extractedGameTime: null,
  }, 30 * 60 * 1000);
  
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [legs, setLegs] = useState<LegInput[]>(persistedData.legs);
  const [stake, setStake] = useState(persistedData.stake);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [extractedTotalOdds, setExtractedTotalOdds] = useState<number | null>(persistedData.extractedTotalOdds);
  const [extractedGameTime, setExtractedGameTime] = useState<string | null>(persistedData.extractedGameTime);
  const [isEditingGameTime, setIsEditingGameTime] = useState(false);
  const [editDate, setEditDate] = useState<Date | undefined>(undefined);
  const [editTime, setEditTime] = useState("19:00");
  const [showPaywall, setShowPaywall] = useState(false);
  const [showPilotPaywall, setShowPilotPaywall] = useState(false);
  const [uploadQueue, setUploadQueue] = useState<QueuedSlip[]>([]);
  const [processingIndex, setProcessingIndex] = useState<number>(-1);
  const [isQuickChecking, setIsQuickChecking] = useState(false);
  const [quickCheckResults, setQuickCheckResults] = useState<any>(null);
  const [showOptimizer, setShowOptimizer] = useState(false);
  const [originalLegs, setOriginalLegs] = useState<LegInput[] | null>(null);
  const [undoCountdown, setUndoCountdown] = useState<number>(0);
  const [videoProgress, setVideoProgress] = useState<ExtractionProgress | null>(null);
  const [showExtractionNudge, setShowExtractionNudge] = useState(false);
  const [showRestoredBanner, setShowRestoredBanner] = useState(false);
  const [lastUploadedSlipUrl, setLastUploadedSlipUrl] = useState<string | null>(null);
  const [extractedPlatform, setExtractedPlatform] = useState<string | null>(null);
  const [extractedPlayType, setExtractedPlayType] = useState<string | null>(null);
  const [extractedMultiplier, setExtractedMultiplier] = useState<number | null>(null);

  // Show restored session banner on mount if data was restored
  useEffect(() => {
    const hasValidLegs = persistedData.legs.some(l => l.description.trim());
    if (hasValidLegs && !persistedData.wasRestored) {
      setShowRestoredBanner(true);
      setPersistedData({ ...persistedData, wasRestored: true });
      haptics.success();
    }
  }, []);

  // Persist state whenever it changes meaningfully
  useEffect(() => {
    const hasContent = legs.some(l => l.description.trim());
    if (hasContent) {
      setPersistedData({
        legs,
        stake,
        extractedTotalOdds,
        extractedGameTime,
        wasRestored: true,
      });
    }
  }, [legs, stake, extractedTotalOdds, extractedGameTime]);

  // Check for success/cancel params from purchase
  useEffect(() => {
    if (searchParams.get('purchase') === 'success') {
      toast({
        title: "Purchase successful! 🎉",
        description: "Your scans have been added.",
      });
      checkPilotStatus();
    } else if (searchParams.get('purchase') === 'cancelled') {
      toast({
        title: "Purchase canceled",
        description: "No charges were made.",
      });
    }
  }, [searchParams, checkPilotStatus]);

  // Restore pending parlay after authentication
  useEffect(() => {
    const pending = sessionStorage.getItem('pendingParlay');
    if (pending && user) {
      try {
        const { legs: savedLegs, stake: savedStake, extractedTotalOdds: savedOdds, extractedGameTime: savedTime } = JSON.parse(pending);
        if (savedLegs?.length >= 2) {
          setLegs(savedLegs);
          if (savedStake) setStake(savedStake);
          if (savedOdds) setExtractedTotalOdds(savedOdds);
          if (savedTime) setExtractedGameTime(savedTime);
          
          toast({
            title: "Parlay restored! 📋",
            description: "Your legs are ready to analyze",
          });
        }
        sessionStorage.removeItem('pendingParlay');
      } catch (e) {
        console.error('Failed to restore pending parlay:', e);
        sessionStorage.removeItem('pendingParlay');
      }
    }
  }, [user]);

  // Handle optimized legs from Results page  
  useEffect(() => {
    const optimizedData = location.state as { 
      optimizedLegs?: Array<{ id: string; description: string; odds: string }>;
      originalLegs?: Array<{ id: string; description: string; odds: string }>;
      optimizationApplied?: boolean;
      removedCount?: number;
    } | null;

    if (optimizedData?.optimizedLegs && optimizedData.optimizationApplied) {
      // Store original legs for undo
      if (optimizedData.originalLegs) {
        setOriginalLegs(optimizedData.originalLegs);
        setUndoCountdown(10);
      }
      
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

  // Countdown timer for undo button
  useEffect(() => {
    if (undoCountdown > 0) {
      const timer = setTimeout(() => {
        setUndoCountdown(undoCountdown - 1);
      }, 1000);
      
      return () => clearTimeout(timer);
    } else if (undoCountdown === 0 && originalLegs) {
      // Clear original legs when countdown expires
      setOriginalLegs(null);
    }
  }, [undoCountdown, originalLegs]);

  const handleUndo = () => {
    if (originalLegs) {
      setLegs(originalLegs);
      setOriginalLegs(null);
      setUndoCountdown(0);
      
      toast({
        title: "↩️ Parlay Restored",
        description: "Original parlay has been restored.",
      });
    }
  };

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
      
      // Auto-show optimizer if problematic legs detected
      const hasProblematicLegs = data.legs.some((leg: any) => 
        leg.riskLevel === 'danger' || leg.riskLevel === 'caution'
      );
      
      if (hasProblematicLegs) {
        setShowOptimizer(true);
      }
      
      // Show toast based on results
      if (data.hasSharpConflicts) {
        haptics.warning();
        toast({
          title: "⚠️ Sharp Conflicts Detected",
          description: data.suggestedAction,
          variant: "destructive",
        });
      } else if (data.overallRisk === 'caution') {
        haptics.mediumTap();
        toast({
          title: "🟡 Proceed with Caution",
          description: data.suggestedAction,
        });
      } else {
        haptics.success();
        toast({
          title: "🟢 Looking Good!",
          description: data.suggestedAction,
        });
      }
    } catch (error) {
      console.error('Quick check error:', error);
      haptics.error();
      toast({
        title: "Quick Check Failed",
        description: "Unable to fetch sharp data. Try again later.",
        variant: "destructive",
      });
    } finally {
      setIsQuickChecking(false);
    }
  };

  const handleRemoveProblematicLegs = (legIds: string[]) => {
    const remainingLegs = legs.filter(leg => !legIds.includes(leg.id));
    
    // Ensure at least 2 legs remain
    if (remainingLegs.length < 2) {
      toast({
        title: "Can't Remove All Legs! 🙅",
        description: "You need at least 2 legs for a parlay. Keep some strong picks!",
        variant: "destructive",
      });
      return;
    }
    
    setLegs(remainingLegs);
    setShowOptimizer(false);
    
    // Clear quick check results to allow re-checking
    setQuickCheckResults(null);
    
    toast({
      title: "✨ Parlay Optimized!",
      description: `Removed ${legIds.length} weak leg${legIds.length > 1 ? 's' : ''}. Re-run Quick Check to verify.`,
    });
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

  const handleClearAll = () => {
    setLegs([
      { id: crypto.randomUUID(), description: "", odds: "" },
      { id: crypto.randomUUID(), description: "", odds: "" },
    ]);
    setExtractedTotalOdds(null);
    setExtractedGameTime(null);
    setStake("10");
    setQuickCheckResults(null);
    setShowOptimizer(false);
    setExtractedPlatform(null);
    setExtractedPlayType(null);
    setExtractedMultiplier(null);
    clearPersistedData();
    haptics.mediumTap();
    
    toast({
      title: "Cleared! 🗑️",
      description: "Ready for a new parlay.",
    });
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
    if (user && !isSubscribed && !isAdmin) {
      // For pilot users, check pilot quota
      if (isPilotUser && !pilotCanScan) {
        setShowPilotPaywall(true);
        return;
      }
      // For regular free users, check regular quota
      if (!isPilotUser && !canScan) {
        setShowPaywall(true);
        return;
      }
    }

    // Check if any file is a video
    const videoFile = files.find(f => isVideoFile(f));
    
    if (videoFile) {
      // Handle video file - extract frames and process
      const validation = validateMediaFile(videoFile);
      if (!validation.valid) {
        toast({
          title: "Invalid video",
          description: validation.error,
          variant: "destructive",
        });
        return;
      }

      setShowExtractionNudge(false); // Clear any previous nudge
      setIsProcessing(true);
      setVideoProgress({ stage: 'loading', currentFrame: 0, totalFrames: 0, message: 'Loading video...' });

      try {
        // Extract frames from video
        const { frames } = await extractFramesFromVideo(videoFile, setVideoProgress);
        
        if (frames.length === 0) {
          throw new Error("Could not extract frames from video");
        }

        setVideoProgress({ 
          stage: 'extracting', 
          currentFrame: 0, 
          totalFrames: frames.length, 
          message: 'Analyzing frames with AI...' 
        });

        // Send all frames to the edge function
        const { data, error } = await supabase.functions.invoke('extract-parlay', {
          body: { frames: frames.map(f => f.base64) }
        });

        if (error) throw new Error(error.message);
        if (data?.error) throw new Error(data.error);

        const extractedLegs = data?.legs || [];
        
        if (extractedLegs.length === 0) {
          setShowExtractionNudge(true);
          haptics.error();
          toast({
            title: "No betting slip found",
            description: `Scanned ${data?.framesProcessed || frames.length} frames but couldn't find parlay data. Try a clearer recording.`,
            variant: "destructive",
          });
          // Do NOT decrement scan - extraction failed
        } else {
          setShowExtractionNudge(false);
          haptics.success();
          // Set extracted legs
          const legInputs: LegInput[] = extractedLegs.map((leg: any) => ({
            id: crypto.randomUUID(),
            description: leg.description || "",
            odds: leg.odds?.replace('+', '') || "",
          }));

          setLegs(legInputs.length >= 2 ? legInputs : 
            [...legInputs, { id: crypto.randomUUID(), description: "", odds: "" }]);

          if (data?.totalOdds) setExtractedTotalOdds(parseInt(data.totalOdds.replace('+', '')));
          if (data?.earliestGameTime) setExtractedGameTime(data.earliestGameTime);
          // stake is now returned as a number from the API
          if (data?.stake !== null && data?.stake !== undefined) setStake(String(data.stake));
          
          // PrizePicks-specific data
          if (data?.platform) setExtractedPlatform(data.platform);
          if (data?.playType) setExtractedPlayType(data.playType);
          if (data?.payoutMultiplier) setExtractedMultiplier(data.payoutMultiplier);

          const platformLabel = data?.platform === 'prizepicks' ? 'PrizePicks' : 'betting slip';
          toast({
            title: `Extracted ${extractedLegs.length} legs from video! 🎬`,
            description: `Found ${platformLabel} in ${data?.framesWithSlips || 1} of ${data?.framesProcessed || frames.length} frames`,
          });

          // For video, we don't store the original video file (too large), just note no slip image
          setLastUploadedSlipUrl(null);

          // Only decrement scan on SUCCESSFUL extraction with legs found
          if (user && !isSubscribed && !isAdmin) {
            if (isPilotUser) {
              await decrementScan('scan');
              // Trigger low scans popup if running low (after decrement, so use totalScansAvailable - 1)
              lowScansPopup.triggerIfLow(totalScansAvailable - 1);
            } else {
              await incrementScan();
            }
          }
        }
      } catch (err) {
        console.error('Video processing error:', err);
        haptics.error();
        toast({
          title: "Video processing failed",
          description: err instanceof Error ? err.message : "Unknown error",
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
        setVideoProgress(null);
      }
      return;
    }

    // Handle image files with parallel processing using queue
    const imageFiles = files
      .filter(file => {
        const validation = validateMediaFile(file);
        if (!validation.valid) {
          toast({
            title: "Invalid file skipped",
            description: validation.error,
            variant: "destructive",
          });
          return false;
        }
        return !validation.isVideo; // Only images in queue
      })
      .slice(0, 10); // Max 10 files at once

    if (imageFiles.length === 0) {
      toast({ title: "No valid images", variant: "destructive" });
      return;
    }

    // Add to queue for visual feedback
    const newQueue: QueuedSlip[] = imageFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      preview: URL.createObjectURL(file),
      status: 'pending' as const,
    }));
    setUploadQueue(newQueue);
    setIsProcessing(true);

    // Process images in parallel batches of 3
    const BATCH_SIZE = 3;
    const allExtractedLegs: LegInput[] = [];
    let lastGameTime: string | null = null;
    let lastTotalOdds: number | null = null;
    let lastStake: string | null = null;
    let lastPlatform: string | null = null;
    let lastPlayType: string | null = null;
    let lastMultiplier: number | null = null;
    let successCount = 0;
    let rateLimitHit = false;

    for (let i = 0; i < imageFiles.length; i += BATCH_SIZE) {
      const batch = imageFiles.slice(i, i + BATCH_SIZE);
      const batchIndices = batch.map((_, idx) => i + idx);
      
      // Update status to processing for this batch
      setUploadQueue(prev => prev.map((item, idx) => 
        batchIndices.includes(idx) ? { ...item, status: 'processing' } : item
      ));
      setProcessingIndex(i);

      // Process batch in parallel
      const batchPromises = batch.map(async (file, batchIdx) => {
        const queueIdx = i + batchIdx;
        try {
          const { base64 } = await compressImage(file);
          const { data, error } = await supabase.functions.invoke('extract-parlay', {
            body: { imageBase64: base64 }
          });

          // Check for rate limit response
          if (error) {
            const errorMessage = error.message?.toLowerCase() || '';
            if (errorMessage.includes('rate') || errorMessage.includes('429')) {
              rateLimitHit = true;
              throw new Error('Rate limited - please wait');
            }
            throw new Error(error.message);
          }
          
          // Check for rate limit in response body
          if (data?.rateLimited || data?.error === 'rate_limited') {
            rateLimitHit = true;
            throw new Error(data.message || 'High demand - please wait');
          }

          if (data?.error) throw new Error(data.error);

          return { queueIdx, data, success: true };
        } catch (err) {
          return { queueIdx, error: String(err), success: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      // Process batch results
      for (const result of batchResults) {
        if (result.success && result.data) {
          const extractedLegs = result.data?.legs || [];
          
          // Add extracted legs to combined list
          extractedLegs.forEach((leg: any) => {
            allExtractedLegs.push({
              id: crypto.randomUUID(),
              description: leg.description || "",
              odds: leg.odds?.replace('+', '') || "",
            });
          });

          // Store data from last successful extraction
          if (result.data?.totalOdds) lastTotalOdds = parseInt(result.data.totalOdds.replace('+', ''));
          if (result.data?.earliestGameTime) lastGameTime = result.data.earliestGameTime;
          if (result.data?.stake !== null && result.data?.stake !== undefined) lastStake = String(result.data.stake);
          if (result.data?.platform) lastPlatform = result.data.platform;
          if (result.data?.playType) lastPlayType = result.data.playType;
          if (result.data?.payoutMultiplier) lastMultiplier = result.data.payoutMultiplier;

          // Update status to success with platform info
          setUploadQueue(prev => prev.map((item, idx) => 
            idx === result.queueIdx ? { 
              ...item, 
              status: 'success', 
              extractedLegs,
              platform: result.data?.platform,
              playType: result.data?.playType,
              payoutMultiplier: result.data?.payoutMultiplier
            } : item
          ));

          if (extractedLegs.length > 0) {
            successCount++;
            setShowExtractionNudge(false);

            // Decrement scan for users - only on successful extraction
            if (user && !isSubscribed && !isAdmin) {
              await decrementScan('scan');
            }
          } else {
            setShowExtractionNudge(true);
          }
        } else {
          setUploadQueue(prev => prev.map((item, idx) => 
            idx === result.queueIdx ? { ...item, status: 'error', error: result.error } : item
          ));
        }
      }

      // If rate limited, show toast and break
      if (rateLimitHit) {
        haptics.warning();
        toast({
          title: "⏳ High Demand",
          description: "Processing queue is busy. Some images will be retried automatically.",
          variant: "default",
        });
        // Continue processing - don't break, just note we hit a limit
      }

      // Small delay between batches to avoid overwhelming
      if (i + BATCH_SIZE < imageFiles.length) {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    // Set combined legs from all slips
    if (allExtractedLegs.length > 0) {
      setLegs(allExtractedLegs.length >= 2 ? allExtractedLegs : 
        [...allExtractedLegs, { id: crypto.randomUUID(), description: "", odds: "" }]);
    }
    
    if (lastTotalOdds) setExtractedTotalOdds(lastTotalOdds);
    if (lastGameTime) setExtractedGameTime(lastGameTime);
    if (lastStake) setStake(lastStake);
    if (lastPlatform) setExtractedPlatform(lastPlatform);
    if (lastPlayType) setExtractedPlayType(lastPlayType);
    if (lastMultiplier) setExtractedMultiplier(lastMultiplier);

    setIsProcessing(false);
    setProcessingIndex(-1);

    if (successCount > 0) {
      haptics.success();
      toast({
        title: `Extracted ${allExtractedLegs.length} total legs! 🎯`,
        description: `From ${successCount} slip${successCount > 1 ? 's' : ''}${rateLimitHit ? ' (some retried)' : ''}`,
      });
      
      // Upload first successful slip image to storage for admin viewing
      if (user && imageFiles.length > 0) {
        try {
          const firstSuccessIdx = uploadQueue.findIndex(q => q.status === 'success');
          const firstFile = firstSuccessIdx >= 0 ? imageFiles[firstSuccessIdx] : imageFiles[0];
          const fileName = `${user.id}/${Date.now()}-${firstFile.name.replace(/[^a-zA-Z0-9.-]/g, '_')}`;
          
          const { data: uploadData, error: uploadError } = await supabase.storage
            .from('betting-slips')
            .upload(fileName, firstFile, { 
              cacheControl: '3600',
              upsert: false 
            });
          
          if (!uploadError && uploadData) {
            const { data: { publicUrl } } = supabase.storage
              .from('betting-slips')
              .getPublicUrl(uploadData.path);
            setLastUploadedSlipUrl(publicUrl);
          }
        } catch (uploadErr) {
          console.error('Slip upload error:', uploadErr);
          // Don't block the flow for upload failures
        }
      }
      
      // Trigger low scans popup if running low (after decrements)
      if (user && !isSubscribed && !isAdmin && isPilotUser) {
        lowScansPopup.triggerIfLow(totalScansAvailable - successCount);
      }
    } else if (rateLimitHit) {
      toast({
        title: "Please try again",
        description: "The system is experiencing high demand. Please wait a moment and try again.",
        variant: "destructive",
      });
    }
  }, [user, canScan, isSubscribed, isAdmin, incrementScan, startCheckout, scansRemaining, haptics, decrementScan, isPilotUser, pilotCanScan, totalScansAvailable, lowScansPopup]);

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
    // Require authentication to analyze
    if (!user) {
      // Save current parlay state to sessionStorage
      sessionStorage.setItem('pendingParlay', JSON.stringify({
        legs,
        stake,
        extractedTotalOdds,
        extractedGameTime
      }));
      
      toast({
        title: "Sign in required",
        description: "Create a free account to analyze your parlay",
      });
      
      navigate('/auth?return=/upload');
      return;
    }

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
    const slipUrlToPass = lastUploadedSlipUrl;
    setExtractedTotalOdds(null);
    setExtractedGameTime(null);
    setLastUploadedSlipUrl(null);
    
    // Navigate to results with simulation data, extracted game time, and slip image URL
    navigate('/results', { state: { simulation, extractedGameTime: gameTimeToPass, slipImageUrl: slipUrlToPass } });
  };

  return (
    <div className="min-h-dvh bg-background pb-nav-safe touch-pan-y overflow-x-safe">
      {/* Mobile Header with Home Navigation */}
      <MobileHeader
        title="Enter Your Slip"
        subtitle="Add your legs and get analyzed"
        showBack
        backTo="/"
        rightAction={
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/')}
            className="h-9 w-9"
          >
            <Home className="h-5 w-5" />
          </Button>
        }
      />

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm,.m4v"
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

      {/* Pilot Paywall Modal */}
      <PilotPaywallModal
        isOpen={showPilotPaywall}
        onClose={() => setShowPilotPaywall(false)}
        onPurchase={purchaseScans}
        freeScansUsed={5}
      />

      <main className="max-w-lg mx-auto px-3 pt-4 pb-40">
        {/* Queue Status Banner */}
        <ExtractionQueueBanner
          isVisible={isProcessing && uploadQueue.length > 1}
          processingCount={uploadQueue.filter(q => q.status === 'processing').length}
          completedCount={uploadQueue.filter(q => q.status === 'success').length}
          totalCount={uploadQueue.length}
          message={uploadQueue.some(q => q.error?.includes('rate') || q.error?.includes('Rate'))
            ? "High demand - retrying automatically..."
            : undefined
          }
          isRateLimited={uploadQueue.some(q => q.error?.includes('rate') || q.error?.includes('Rate'))}
          onCancel={() => {
            setIsProcessing(false);
            setUploadQueue([]);
            toast({ title: "Processing cancelled" });
          }}
        />

        {/* Hint for new users */}
        {shouldShowHint('upload-intro') && (
          <div className="mb-4">
            <HintTooltip
              id="upload-intro"
              message="Upload a screenshot of your parlay slip or manually enter your legs. Our AI will extract the details and analyze your bet."
              position="bottom"
              onDismiss={() => dismissHint('upload-intro')}
            />
          </div>
        )}

        {/* Scan Counter / Pro Badge */}
        {user && (
          <div className="flex justify-center items-center gap-2 mb-4">
            {isSubscribed || isAdmin ? (
              <Badge className="bg-primary/20 text-primary border-primary/30 gap-1">
                <Crown className="w-3 h-3" />
                {isAdmin ? 'ADMIN' : 'PRO'} - Unlimited Scans
              </Badge>
            ) : isPilotUser ? (
              <>
                <Badge 
                  variant="outline" 
                  className={cn(
                    "gap-1",
                    totalScansAvailable === 0 && "border-destructive/50 text-destructive"
                  )}
                >
                  {totalScansAvailable} Scans Available
                </Badge>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setShowPilotPaywall(true)}
                  className="text-primary hover:text-primary/80 hover:bg-primary/10"
                >
                  <Crown className="w-4 h-4 mr-1" />
                  Buy More
                </Button>
              </>
            ) : null}
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
                  {videoProgress ? 'Processing Screen Recording...' : 'AI Scanning Your Slip...'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {videoProgress ? videoProgress.message : 'Extracting your parlay legs'}
                </p>
                
                {/* Video Progress */}
                {videoProgress && (
                  <div className="mt-4 space-y-2">
                    <Progress 
                      value={videoProgress.totalFrames > 0 
                        ? (videoProgress.currentFrame / videoProgress.totalFrames) * 100 
                        : 0
                      } 
                    />
                    <p className="text-xs text-muted-foreground">
                      {videoProgress.stage === 'extracting' 
                        ? `Frame ${videoProgress.currentFrame}/${videoProgress.totalFrames}`
                        : videoProgress.stage === 'complete'
                          ? 'Analyzing with AI...'
                          : 'Loading video...'
                      }
                    </p>
                  </div>
                )}
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
                  Upload photos or screen recordings
                  <br />
                  <span className="text-xs opacity-70 flex items-center justify-center gap-1">
                    <Image className="w-3 h-3" /> Images
                    <span className="mx-1">•</span>
                    <Video className="w-3 h-3" /> MP4, MOV, WebM
                  </span>
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
            {uploadQueue.length > 0 && isProcessing && !videoProgress && (
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

        {/* Clearer Screenshot Nudge - shown when extraction fails */}
        {showExtractionNudge && (
          <div className="mb-5">
            <ClearerScreenshotNudge 
              onRetry={() => {
                setShowExtractionNudge(false);
                fileInputRef.current?.click();
              }} 
            />
          </div>
        )}

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-xs">or enter manually</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Undo Banner */}
        {originalLegs && undoCountdown > 0 && (
          <div className="bg-primary/10 border border-primary/30 rounded-xl p-3 flex items-center justify-between slide-up mb-4">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0">
                <span className="text-lg font-bold text-primary">{undoCountdown}</span>
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">Optimization Applied</p>
                <p className="text-xs text-muted-foreground">Undo available for {undoCountdown}s</p>
              </div>
            </div>
            <Button 
              variant="outline" 
              size="sm" 
              onClick={handleUndo}
              className="border-primary/30 text-primary hover:bg-primary/20 hover:border-primary/50"
            >
              ↩️ Undo
            </Button>
          </div>
        )}

        {/* Extracted Data Banners */}
        <div className="space-y-2 mb-4">
          {/* PrizePicks Platform Banner */}
          {extractedPlatform === 'prizepicks' && (
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-3 flex items-center justify-between slide-up">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-purple-400" />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-purple-300">PrizePicks</p>
                    {extractedPlayType && (
                      <Badge variant="outline" className="text-xs border-purple-400/50 text-purple-300">
                        {extractedPlayType === 'power_play' ? 'Power Play' : 'Flex Play'}
                      </Badge>
                    )}
                  </div>
                  {extractedMultiplier && (
                    <p className="text-xs text-muted-foreground">
                      {extractedMultiplier}x Payout Multiplier
                    </p>
                  )}
                </div>
              </div>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => {
                  setExtractedPlatform(null);
                  setExtractedPlayType(null);
                  setExtractedMultiplier(null);
                }}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="w-4 h-4" />
              </Button>
            </div>
          )}

          {/* Extracted Total Odds Banner */}
          {extractedTotalOdds && (
            <div className="bg-neon-green/10 border border-neon-green/30 rounded-xl p-3 flex items-center justify-between slide-up">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-5 h-5 text-neon-green" />
                <div>
                  <p className="text-xs text-muted-foreground">
                    {extractedPlatform === 'prizepicks' ? 'Estimated Odds (from multiplier)' : 'Total Parlay Odds (from slip)'}
                  </p>
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm text-muted-foreground uppercase tracking-wider">
              📋 Your Legs ({legs.length})
            </p>
            {legs.some(l => l.description.trim() || l.odds.trim()) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClearAll}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 h-7 px-2"
              >
                <Trash2 className="w-3.5 h-3.5 mr-1" />
                Clear All
              </Button>
            )}
          </div>
          
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
        <div className="mb-5 space-y-3">
          <Button
            variant="outline"
            size="lg"
            className={cn(
              "w-full transition-all",
              legs.filter(l => l.description.trim()).length >= 2
                ? "border-primary/30 text-primary hover:bg-primary/10 hover:border-primary/50"
                : "border-muted text-muted-foreground cursor-not-allowed opacity-50"
            )}
            onClick={handleQuickCheck}
            disabled={isQuickChecking || legs.filter(l => l.description.trim()).length < 2}
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
          
          {/* Hint when disabled */}
          {legs.filter(l => l.description.trim()).length < 2 && (
            <p className="text-xs text-muted-foreground text-center">
              Enter at least 2 legs to check against sharp money data
            </p>
          )}
          
          {/* Results when available */}
          {quickCheckResults && (
            <>
              <QuickCheckResults results={quickCheckResults} />
              
              {showOptimizer && (
                <UploadOptimizer
                  legs={legs}
                  quickCheckResults={quickCheckResults}
                  onRemoveLegs={handleRemoveProblematicLegs}
                  onDismiss={() => setShowOptimizer(false)}
                />
              )}
            </>
          )}
        </div>
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

      {/* Low Scans Popup */}
      <LowScansPopup
        isOpen={lowScansPopup.isOpen}
        onClose={lowScansPopup.close}
        onDismiss={lowScansPopup.dismiss}
        onPurchase={(packType) => {
          lowScansPopup.close();
          purchaseScans(packType);
        }}
        scansRemaining={totalScansAvailable}
        isPurchasing={isPilotPurchasing}
      />
    </div>
  );
};

export default Upload;
