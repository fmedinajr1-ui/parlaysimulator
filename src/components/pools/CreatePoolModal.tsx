import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Copy, Check, Users, Trophy, Share2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { shareContent, getShareableUrl } from '@/lib/utils';

interface CreatePoolModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPoolCreated: () => void;
}

export function CreatePoolModal({ open, onOpenChange, onPoolCreated }: CreatePoolModalProps) {
  const [poolName, setPoolName] = useState('');
  const [numLegs, setNumLegs] = useState(4);
  const [stakeAmount, setStakeAmount] = useState(10);
  const [creating, setCreating] = useState(false);
  const [createdPool, setCreatedPool] = useState<{ id: string; invite_code: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const handleCreate = async () => {
    if (!poolName.trim()) {
      toast.error('Please enter a pool name');
      return;
    }

    setCreating(true);

    try {
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;

      const response = await supabase.functions.invoke('pool-manager', {
        body: {
          action: 'create',
          pool_name: poolName.trim(),
          num_legs_required: numLegs,
          stake_per_member: stakeAmount
        },
        headers: { Authorization: `Bearer ${token}` }
      });

      if (response.data?.error) {
        toast.error(response.data.error);
        return;
      }

      if (response.data?.pool) {
        setCreatedPool({
          id: response.data.pool.id,
          invite_code: response.data.pool.invite_code
        });
        toast.success('Pool created successfully!');
      }
    } catch (error) {
      console.error('Error creating pool:', error);
      toast.error('Failed to create pool');
    } finally {
      setCreating(false);
    }
  };

  const copyInviteLink = () => {
    if (!createdPool) return;
    navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    toast.success('Link copied!');
    setTimeout(() => setCopied(false), 2000);
  };

  const shareInviteLink = async () => {
    if (!createdPool) return;
    const shared = await shareContent({
      title: poolName,
      text: `Join my parlay pool: ${poolName}`,
      url: inviteLink
    });
    if (!shared) {
      toast.success('Link copied!');
    }
  };

  const handleClose = () => {
    if (createdPool) {
      onPoolCreated();
    }
    setPoolName('');
    setNumLegs(4);
    setStakeAmount(10);
    setCreatedPool(null);
    setCopied(false);
    onOpenChange(false);
  };

  const inviteLink = createdPool 
    ? getShareableUrl(`/pools/join/${createdPool.invite_code}`)
    : '';

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="w-5 h-5 text-primary" />
            {createdPool ? 'Pool Created!' : 'Create Parlay Pool'}
          </DialogTitle>
        </DialogHeader>

        {createdPool ? (
          <div className="space-y-4">
            <div className="text-center py-4">
              <div className="w-16 h-16 mx-auto mb-4 rounded-full gradient-neon flex items-center justify-center">
                <Trophy className="w-8 h-8 text-primary-foreground" />
              </div>
              <h3 className="font-display text-xl mb-2">Your pool is ready!</h3>
              <p className="text-sm text-muted-foreground">
                Share the link below to invite friends
              </p>
            </div>

            <div className="bg-muted rounded-lg p-4">
              <Label className="text-xs text-muted-foreground mb-2 block">Invite Link</Label>
              <div className="flex gap-2">
                <Input
                  value={inviteLink}
                  readOnly
                  className="text-sm bg-background flex-1"
                />
                <Button onClick={copyInviteLink} variant="outline" size="icon">
                  {copied ? (
                    <Check className="w-4 h-4 text-neon-green" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </Button>
                <Button onClick={shareInviteLink} variant="outline" size="icon">
                  <Share2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            <div className="flex gap-2">
              <Button 
                className="flex-1" 
                variant="outline"
                onClick={handleClose}
              >
                Close
              </Button>
              <Button 
                className="flex-1 gradient-neon text-primary-foreground"
                onClick={() => {
                  handleClose();
                  window.location.href = `/pools/${createdPool.id}`;
                }}
              >
                View Pool
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="poolName">Pool Name</Label>
              <Input
                id="poolName"
                placeholder="e.g., Sunday NFL Squad"
                value={poolName}
                onChange={(e) => setPoolName(e.target.value)}
                maxLength={50}
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Number of Legs</Label>
                <span className="text-xl font-display text-primary">{numLegs}</span>
              </div>
              <Slider
                value={[numLegs]}
                onValueChange={(values) => setNumLegs(values[0])}
                min={2}
                max={20}
                step={1}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>2 legs</span>
                <span>20 legs</span>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <Label>Stake per Member</Label>
                <span className="text-xl font-display text-neon-green">${stakeAmount}</span>
              </div>
              <Slider
                value={[stakeAmount]}
                onValueChange={(values) => setStakeAmount(values[0])}
                min={5}
                max={100}
                step={5}
                className="w-full"
              />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>$5</span>
                <span>$100</span>
              </div>
            </div>

            <div className="bg-muted rounded-lg p-4 text-sm">
              <h4 className="font-medium mb-2">Pool Summary</h4>
              <ul className="space-y-1 text-muted-foreground">
                <li>• Each member contributes 1 leg</li>
                <li>• Pool locks when {numLegs} legs are submitted</li>
                <li>• Total pool stake: ${stakeAmount * numLegs}</li>
              </ul>
            </div>

            <Button 
              onClick={handleCreate} 
              className="w-full gradient-neon text-primary-foreground"
              disabled={creating || !poolName.trim()}
            >
              {creating ? 'Creating...' : 'Create Pool'}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
