import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { Trophy } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SubmitLegModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poolId: string;
  onLegSubmitted: () => void;
}

export function SubmitLegModal({ open, onOpenChange, poolId, onLegSubmitted }: SubmitLegModalProps) {
  const [description, setDescription] = useState('');
  const [odds, setOdds] = useState('');
  const [betType, setBetType] = useState('prop');
  const [sport, setSport] = useState('NBA');
  const [playerName, setPlayerName] = useState('');
  const [propType, setPropType] = useState('');
  const [line, setLine] = useState('');
  const [side, setSide] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async () => {
    if (!description.trim()) {
      toast.error('Please enter a description');
      return;
    }

    const oddsNum = parseInt(odds);
    if (isNaN(oddsNum) || oddsNum === 0) {
      toast.error('Please enter valid odds');
      return;
    }

    setSubmitting(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await supabase.functions.invoke('pool-manager', {
        body: {
          action: 'submit-leg',
          pool_id: poolId,
          description: description.trim(),
          odds: oddsNum,
          bet_type: betType,
          sport,
          player_name: playerName.trim() || null,
          prop_type: propType.trim() || null,
          line: line ? parseFloat(line) : null,
          side: side || null,
          engine_source: 'manual'
        },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data?.error) {
        toast.error(response.data.error);
        return;
      }

      toast.success('Leg submitted successfully!');
      
      if (response.data?.pool_locked) {
        toast.info('Pool is now locked - all legs submitted!');
      }

      onLegSubmitted();
      handleClose();
    } catch (error) {
      console.error('Error submitting leg:', error);
      toast.error('Failed to submit leg');
    } finally {
      setSubmitting(false);
    }
  };

  const handleClose = () => {
    setDescription('');
    setOdds('');
    setBetType('prop');
    setSport('NBA');
    setPlayerName('');
    setPropType('');
    setLine('');
    setSide('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trophy className="w-5 h-5 text-neon-green" />
            Submit Your Leg
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="description">Pick Description *</Label>
            <Textarea
              id="description"
              placeholder="e.g., LeBron James Over 25.5 Points"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="odds">Odds (American) *</Label>
              <Input
                id="odds"
                placeholder="-110"
                value={odds}
                onChange={(e) => setOdds(e.target.value)}
                type="number"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="betType">Bet Type</Label>
              <Select value={betType} onValueChange={setBetType}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="prop">Player Prop</SelectItem>
                  <SelectItem value="spread">Spread</SelectItem>
                  <SelectItem value="total">Total</SelectItem>
                  <SelectItem value="moneyline">Moneyline</SelectItem>
                  <SelectItem value="first_scorer">First Scorer</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="sport">Sport</Label>
            <Select value={sport} onValueChange={setSport}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NBA">NBA</SelectItem>
                <SelectItem value="NFL">NFL</SelectItem>
                <SelectItem value="NHL">NHL</SelectItem>
                <SelectItem value="MLB">MLB</SelectItem>
                <SelectItem value="NCAAB">NCAAB</SelectItem>
                <SelectItem value="NCAAF">NCAAF</SelectItem>
                <SelectItem value="Soccer">Soccer</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {betType === 'prop' && (
            <>
              <div className="space-y-2">
                <Label htmlFor="playerName">Player Name</Label>
                <Input
                  id="playerName"
                  placeholder="e.g., LeBron James"
                  value={playerName}
                  onChange={(e) => setPlayerName(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="propType">Prop Type</Label>
                  <Input
                    id="propType"
                    placeholder="Points"
                    value={propType}
                    onChange={(e) => setPropType(e.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="line">Line</Label>
                  <Input
                    id="line"
                    placeholder="25.5"
                    value={line}
                    onChange={(e) => setLine(e.target.value)}
                    type="number"
                    step="0.5"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="side">Side</Label>
                  <Select value={side} onValueChange={setSide}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="over">Over</SelectItem>
                      <SelectItem value="under">Under</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </>
          )}

          <div className="bg-muted rounded-lg p-3 text-sm text-muted-foreground">
            <p>💡 Tip: Be specific with your pick description so other members can verify the outcome.</p>
          </div>

          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} className="flex-1">
              Cancel
            </Button>
            <Button 
              onClick={handleSubmit} 
              className="flex-1 gradient-neon text-primary-foreground"
              disabled={submitting || !description.trim() || !odds}
            >
              {submitting ? 'Submitting...' : 'Submit Leg'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
