import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Plus, Trash2, Upload as UploadIcon, Flame, X } from "lucide-react";
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

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    // In a real app, you'd process the file here with OCR
    toast({
      title: "Image uploaded! 📸",
      description: "OCR coming soon. For now, enter your legs manually.",
    });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
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
    <div className="min-h-screen bg-background pb-32">
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="font-display text-3xl text-gradient-fire mb-2">
            🎟️ ENTER YOUR SLIP
          </h1>
          <p className="text-muted-foreground">
            Add your legs and prepare for judgment.
          </p>
        </div>

        {/* Drop Zone */}
        <FeedCard 
          className={`mb-6 transition-all duration-200 ${isDragging ? 'border-2 border-neon-green border-dashed scale-[1.02]' : 'border border-dashed border-border'}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full gradient-neon mx-auto mb-4 flex items-center justify-center">
              <UploadIcon className="w-8 h-8 text-background" />
            </div>
            <p className="font-semibold text-foreground mb-1">
              Drag & Drop Your Slip
            </p>
            <p className="text-sm text-muted-foreground mb-3">
              or tap to upload (OCR coming soon)
            </p>
            <Button variant="muted" size="sm">
              Browse Files
            </Button>
          </div>
        </FeedCard>

        {/* Divider */}
        <div className="flex items-center gap-4 mb-6">
          <div className="flex-1 h-px bg-border" />
          <span className="text-muted-foreground text-sm">or enter manually</span>
          <div className="flex-1 h-px bg-border" />
        </div>

        {/* Legs Table */}
        <FeedCard className="mb-6">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-4">
            📋 Your Legs ({legs.length})
          </p>
          
          <div className="space-y-3">
            {legs.map((leg, idx) => (
              <div key={leg.id} className="flex gap-2 items-center slide-up" style={{ animationDelay: `${idx * 50}ms` }}>
                <span className="text-muted-foreground font-bold w-8 text-center shrink-0">
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
                  className="w-24 text-center"
                />
                <Button 
                  variant="ghost" 
                  size="icon"
                  onClick={() => removeLeg(leg.id)}
                  className="shrink-0 text-muted-foreground hover:text-destructive"
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>

          <Button 
            variant="muted" 
            className="w-full mt-4"
            onClick={addLeg}
          >
            <Plus className="w-4 h-4" />
            Add Leg
          </Button>
        </FeedCard>

        {/* Stake Input */}
        <FeedCard className="mb-6">
          <p className="text-sm text-muted-foreground uppercase tracking-wider mb-3">
            💰 Your Stake
          </p>
          <div className="flex items-center gap-3">
            <span className="text-2xl text-muted-foreground">$</span>
            <Input
              type="number"
              placeholder="10.00"
              value={stake}
              onChange={(e) => setStake(e.target.value)}
              className="text-2xl font-bold text-center"
            />
          </div>
        </FeedCard>
      </main>

      {/* Sticky CTA */}
      <div className="fixed bottom-20 left-0 right-0 p-4 bg-gradient-to-t from-background via-background to-transparent">
        <div className="max-w-lg mx-auto">
          <Button 
            variant="fire" 
            size="xl" 
            className="w-full font-display text-xl tracking-wider"
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
