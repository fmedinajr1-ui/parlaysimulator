import { useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Upload as UploadIcon, Flame, X } from "lucide-react";
import { createLeg, simulateParlay } from "@/lib/parlay-calculator";
import { ParlayLeg } from "@/types/parlay";
import { toast } from "@/hooks/use-toast";

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
  };

  const handleFileSelect = useCallback((file: File) => {
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

    toast({
      title: "Image uploaded! 📸",
      description: "OCR coming soon. For now, enter your legs manually.",
    });
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
    fileInputRef.current?.click();
  }, []);

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

    const stakeNum = parseFloat(stake);
    if (isNaN(stakeNum) || stakeNum <= 0) {
      toast({
        title: "Invalid stake! 💸",
        description: "How much are you putting on this?",
        variant: "destructive",
      });
      return;
    }

    // Run simulation
    const simulation = simulateParlay(validLegs, stakeNum);
    
    // Navigate to results with simulation data
    navigate('/results', { state: { simulation } });
  };

  return (
    <div className="min-h-screen bg-background pb-32 touch-pan-y">
      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
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

        {/* Drop Zone - Now Tappable */}
        <FeedCard 
          variant="full-bleed"
          className={`mb-5 transition-all duration-200 cursor-pointer active:scale-[0.98] ${
            isDragging 
              ? 'border-2 border-neon-green border-dashed scale-[1.02]' 
              : 'border border-dashed border-border'
          }`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={triggerFileInput}
        >
          <div className="text-center py-6">
            <div className="w-14 h-14 rounded-full gradient-neon mx-auto mb-3 flex items-center justify-center">
              <UploadIcon className="w-7 h-7 text-background" />
            </div>
            <p className="font-semibold text-foreground mb-1">
              Tap to Upload Your Slip
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              or drag & drop (OCR coming soon)
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
          </div>
        </FeedCard>

        {/* Divider */}
        <div className="flex items-center gap-3 mb-5">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-xs">or enter manually</span>
          <div className="flex-1 h-px bg-border" />
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
                  placeholder="+150"
                  value={leg.odds}
                  onChange={(e) => updateLeg(leg.id, 'odds', e.target.value)}
                  className="w-20 text-center"
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
