import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { 
  Upload, 
  Image as ImageIcon, 
  X, 
  Loader2, 
  CheckCircle, 
  AlertCircle,
  Save,
  Trash2,
  Edit2
} from 'lucide-react';

interface QueuedImage {
  id: string;
  file: File;
  preview: string;
  status: 'pending' | 'processing' | 'success' | 'error';
  result?: ExtractedParlay;
  error?: string;
}

interface ExtractedLeg {
  description: string;
  odds: string;  // American odds format e.g. "+150" or "-110"
  gameTime?: string | null;
  gameTimeISO?: string | null;
  sport?: string;
  betType?: string;
}

interface ExtractedParlay {
  legs: ExtractedLeg[];
  stake: number | null;
  potentialPayout: number | null;
  earliestGameTime?: string | null;
  earliestGameTimeISO?: string | null;
  isBettingSlip?: boolean;
  originalOddsFormat?: 'american' | 'decimal' | 'fractional' | null;
  sport?: string;
}

// Helper to parse American odds string to number
function parseOddsToNumber(odds: string): number {
  const cleaned = odds.replace(/[+\s]/g, '');
  const num = parseInt(cleaned, 10);
  return isNaN(num) ? 0 : num;
}

const SPORTS = ['NBA', 'NFL', 'NHL', 'MLB', 'NCAAB', 'NCAAF', 'Soccer', 'UFC', 'Other'];
const BET_TYPES = ['moneyline', 'spread', 'total', 'player_prop', 'other'];

export function BulkSlipUpload() {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [queue, setQueue] = useState<QueuedImage[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [processedCount, setProcessedCount] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);

  const handleFileSelect = useCallback((files: FileList | null) => {
    if (!files) return;
    
    const newImages: QueuedImage[] = [];
    const maxFiles = 20;
    const currentCount = queue.length;
    
    for (let i = 0; i < Math.min(files.length, maxFiles - currentCount); i++) {
      const file = files[i];
      if (file.type.startsWith('image/')) {
        newImages.push({
          id: `${Date.now()}-${i}-${Math.random().toString(36).substr(2, 9)}`,
          file,
          preview: URL.createObjectURL(file),
          status: 'pending'
        });
      }
    }
    
    setQueue(prev => [...prev, ...newImages]);
  }, [queue.length]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    handleFileSelect(e.dataTransfer.files);
  }, [handleFileSelect]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue(prev => {
      const item = prev.find(q => q.id === id);
      if (item?.preview) {
        URL.revokeObjectURL(item.preview);
      }
      return prev.filter(q => q.id !== id);
    });
  }, []);

  const compressAndConvert = async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      
      img.onload = () => {
        const maxDim = 1024;
        let { width, height } = img;
        
        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = (height / width) * maxDim;
            width = maxDim;
          } else {
            width = (width / height) * maxDim;
            height = maxDim;
          }
        }
        
        canvas.width = width;
        canvas.height = height;
        ctx?.drawImage(img, 0, 0, width, height);
        
        const base64 = canvas.toDataURL('image/jpeg', 0.8);
        resolve(base64.split(',')[1]);
      };
      
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  };

  const processQueue = async () => {
    if (queue.length === 0) return;
    
    setIsProcessing(true);
    setProcessedCount(0);
    
    for (let i = 0; i < queue.length; i++) {
      const item = queue[i];
      if (item.status !== 'pending') continue;
      
      // Update status to processing
      setQueue(prev => prev.map(q => 
        q.id === item.id ? { ...q, status: 'processing' as const } : q
      ));
      
      try {
        const base64 = await compressAndConvert(item.file);
        
        const { data, error } = await supabase.functions.invoke('extract-parlay', {
          body: { imageBase64: base64 }
        });
        
        if (error) throw error;
        
        setQueue(prev => prev.map(q => 
          q.id === item.id ? { 
            ...q, 
            status: 'success' as const,
            result: data as ExtractedParlay
          } : q
        ));
      } catch (err) {
        console.error('Error processing image:', err);
        setQueue(prev => prev.map(q => 
          q.id === item.id ? { 
            ...q, 
            status: 'error' as const,
            error: err instanceof Error ? err.message : 'Failed to extract'
          } : q
        ));
      }
      
      setProcessedCount(i + 1);
      
      // Small delay to avoid rate limiting
      if (i < queue.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }
    
    setIsProcessing(false);
  };

  const updateLeg = (imageId: string, legIndex: number, field: string, value: string | number) => {
    setQueue(prev => prev.map(q => {
      if (q.id !== imageId || !q.result) return q;
      
      const newLegs = [...q.result.legs];
      newLegs[legIndex] = { ...newLegs[legIndex], [field]: value };
      
      return {
        ...q,
        result: { ...q.result, legs: newLegs }
      };
    }));
  };

  const saveAllToTraining = async () => {
    if (!user) {
      toast({
        title: "Error",
        description: "You must be logged in to save training data",
        variant: "destructive"
      });
      return;
    }
    
    const successfulExtracts = queue.filter(q => q.status === 'success' && q.result);
    if (successfulExtracts.length === 0) {
      toast({
        title: "No Data",
        description: "No successfully extracted parlays to save",
        variant: "destructive"
      });
      return;
    }
    
    setIsSaving(true);
    let savedCount = 0;
    
    try {
      for (const item of successfulExtracts) {
        if (!item.result) continue;
        
        // Create parlay history entry
        const combinedOdds = item.result.legs.reduce((acc, leg) => {
          const oddsNum = parseOddsToNumber(leg.odds);
          const decimalOdds = oddsNum > 0 
            ? (oddsNum / 100) + 1 
            : (100 / Math.abs(oddsNum)) + 1;
          return acc * decimalOdds;
        }, 1);
        
        const impliedProb = 1 / combinedOdds;
        
        const { data: parlayData, error: parlayError } = await supabase
          .from('parlay_history')
          .insert({
            user_id: user.id,
            legs: item.result.legs.map(leg => ({
              description: leg.description,
              odds: leg.odds
            })),
            stake: item.result.stake || 10,
            potential_payout: item.result.potentialPayout || (10 * combinedOdds),
            combined_probability: impliedProb,
            degenerate_level: impliedProb < 0.05 ? 'LOAN_NEEDED' : 
                              impliedProb < 0.1 ? 'LOTTERY_TICKET' : 
                              impliedProb < 0.2 ? 'SWEAT_SEASON' : 
                              impliedProb < 0.35 ? 'NOT_TERRIBLE' : 'RESPECTABLE',
            is_settled: false
          })
          .select()
          .single();
        
        if (parlayError) {
          console.error('Error saving parlay:', parlayError);
          continue;
        }
        
        // Create training data entries for each leg
        const trainingEntries = item.result.legs.map((leg, idx) => {
          const oddsNum = parseOddsToNumber(leg.odds);
          const decimalOdds = oddsNum > 0 
            ? (oddsNum / 100) + 1 
            : (100 / Math.abs(oddsNum)) + 1;
          const impliedProbability = 1 / decimalOdds;
          
          return {
            parlay_history_id: parlayData.id,
            user_id: user.id,
            leg_index: idx,
            description: leg.description,
            odds: oddsNum,
            implied_probability: impliedProbability,
            sport: leg.sport || item.result?.sport || 'Unknown',
            bet_type: leg.betType || 'other'
          };
        });
        
        const { error: trainingError } = await supabase
          .from('parlay_training_data')
          .insert(trainingEntries);
        
        if (trainingError) {
          console.error('Error saving training data:', trainingError);
        } else {
          savedCount++;
        }
      }
      
      toast({
        title: "Saved Successfully",
        description: `${savedCount} parlays saved to AI training data`
      });
      
      // Clear successful items from queue
      setQueue(prev => prev.filter(q => q.status !== 'success'));
      
    } catch (err) {
      console.error('Error saving to training:', err);
      toast({
        title: "Error",
        description: "Failed to save some training data",
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const successCount = queue.filter(q => q.status === 'success').length;
  const errorCount = queue.filter(q => q.status === 'error').length;
  const pendingCount = queue.filter(q => q.status === 'pending').length;

  return (
    <div className="space-y-4">
      {/* Upload Zone */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Upload className="w-4 h-4 text-primary" />
            Bulk Upload Betting Slips
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-lg p-8 text-center cursor-pointer hover:border-primary/50 hover:bg-primary/5 transition-colors"
          >
            <ImageIcon className="w-12 h-12 mx-auto mb-3 text-muted-foreground" />
            <p className="text-sm font-medium text-foreground mb-1">
              Drag & Drop Images Here
            </p>
            <p className="text-xs text-muted-foreground">
              or click to browse • PNG, JPG, WEBP (max 20)
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </CardContent>
      </Card>

      {/* Queue Status */}
      {queue.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Upload Queue ({queue.length})</CardTitle>
              <div className="flex gap-2">
                <Badge variant="outline" className="text-xs">
                  {pendingCount} pending
                </Badge>
                {successCount > 0 && (
                  <Badge variant="default" className="text-xs bg-green-500/20 text-green-500">
                    {successCount} success
                  </Badge>
                )}
                {errorCount > 0 && (
                  <Badge variant="destructive" className="text-xs">
                    {errorCount} failed
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Processing Progress */}
            {isProcessing && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm">
                  <span>Processing...</span>
                  <span>{processedCount}/{queue.length}</span>
                </div>
                <Progress value={(processedCount / queue.length) * 100} className="h-2" />
              </div>
            )}

            {/* Image Grid */}
            <div className="grid grid-cols-4 gap-2">
              {queue.map((item) => (
                <div 
                  key={item.id} 
                  className="relative aspect-square rounded-lg overflow-hidden border border-border"
                >
                  <img 
                    src={item.preview} 
                    alt="Slip" 
                    className="w-full h-full object-cover"
                  />
                  <div className={`absolute inset-0 flex items-center justify-center ${
                    item.status === 'processing' ? 'bg-background/80' :
                    item.status === 'success' ? 'bg-green-500/20' :
                    item.status === 'error' ? 'bg-red-500/20' : ''
                  }`}>
                    {item.status === 'processing' && (
                      <Loader2 className="w-6 h-6 animate-spin text-primary" />
                    )}
                    {item.status === 'success' && (
                      <CheckCircle className="w-6 h-6 text-green-500" />
                    )}
                    {item.status === 'error' && (
                      <AlertCircle className="w-6 h-6 text-red-500" />
                    )}
                  </div>
                  <button
                    onClick={() => removeFromQueue(item.id)}
                    className="absolute top-1 right-1 p-1 rounded-full bg-background/80 hover:bg-background"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              ))}
            </div>

            {/* Action Buttons */}
            <div className="flex gap-2">
              <Button 
                onClick={processQueue} 
                disabled={isProcessing || pendingCount === 0}
                className="flex-1"
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  'Start Processing'
                )}
              </Button>
              <Button 
                onClick={() => setQueue([])}
                variant="outline"
                disabled={isProcessing}
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Extracted Results */}
      {successCount > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Extracted Results ({successCount})</CardTitle>
              <Button 
                onClick={saveAllToTraining}
                disabled={isSaving}
                size="sm"
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="w-4 h-4 mr-2" />
                    Save All to AI Training
                  </>
                )}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {queue.filter(q => q.status === 'success' && q.result).map((item) => (
              <div key={item.id} className="p-3 rounded-lg bg-muted/50 border border-border">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <img 
                      src={item.preview} 
                      alt="Slip" 
                      className="w-10 h-10 rounded object-cover"
                    />
                    <div>
                      <p className="text-sm font-medium">{item.result?.legs.length} Legs Extracted</p>
                      <p className="text-xs text-muted-foreground">
                        Stake: ${item.result?.stake || 'N/A'} • 
                        Payout: ${typeof item.result?.potentialPayout === 'number' ? item.result.potentialPayout.toFixed(2) : 'N/A'}
                      </p>
                    </div>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm"
                    onClick={() => setEditingId(editingId === item.id ? null : item.id)}
                  >
                    <Edit2 className="w-4 h-4" />
                  </Button>
                </div>
                
                {/* Leg Details */}
                <div className="space-y-2">
                  {item.result?.legs.map((leg, idx) => (
                    <div key={idx} className="text-xs p-2 rounded bg-background/50">
                      {editingId === item.id ? (
                        <div className="space-y-2">
                          <Input
                            value={leg.description}
                            onChange={(e) => updateLeg(item.id, idx, 'description', e.target.value)}
                            className="text-xs h-8"
                          />
                          <div className="flex gap-2">
                            <Select
                              value={leg.sport || ''}
                              onValueChange={(v) => updateLeg(item.id, idx, 'sport', v)}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1">
                                <SelectValue placeholder="Sport" />
                              </SelectTrigger>
                              <SelectContent>
                                {SPORTS.map(s => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Select
                              value={leg.betType || ''}
                              onValueChange={(v) => updateLeg(item.id, idx, 'betType', v)}
                            >
                              <SelectTrigger className="h-8 text-xs flex-1">
                                <SelectValue placeholder="Bet Type" />
                              </SelectTrigger>
                              <SelectContent>
                                {BET_TYPES.map(t => (
                                  <SelectItem key={t} value={t}>{t}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <Input
                              type="number"
                              value={leg.odds}
                              onChange={(e) => updateLeg(item.id, idx, 'odds', Number(e.target.value))}
                              className="h-8 text-xs w-20"
                              placeholder="Odds"
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="truncate flex-1">{leg.description}</span>
                          <div className="flex items-center gap-2">
                            {leg.sport && (
                              <Badge variant="outline" className="text-xs">
                                {leg.sport}
                              </Badge>
                            )}
                            <span className={`font-mono ${
                              parseOddsToNumber(leg.odds) > 0 ? 'text-green-500' : 'text-red-500'
                            }`}>
                              {leg.odds.startsWith('-') || leg.odds.startsWith('+') ? leg.odds : `+${leg.odds}`}
                            </span>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
