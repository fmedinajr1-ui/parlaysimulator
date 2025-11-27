import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { FeedCard } from '@/components/FeedCard';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Twitter, Instagram, Pencil, Check, X, ExternalLink } from 'lucide-react';

interface SocialLinksProps {
  twitterHandle: string | null;
  instagramHandle: string | null;
  onUpdate: (updates: { twitter_handle?: string | null; instagram_handle?: string | null }) => void;
}

export const SocialLinks = ({ twitterHandle, instagramHandle, onUpdate }: SocialLinksProps) => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [twitter, setTwitter] = useState(twitterHandle || '');
  const [instagram, setInstagram] = useState(instagramHandle || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      // Clean up handles (remove @ if present)
      const cleanTwitter = twitter.replace('@', '').trim() || null;
      const cleanInstagram = instagram.replace('@', '').trim() || null;

      const { error } = await supabase
        .from('profiles')
        .update({
          twitter_handle: cleanTwitter,
          instagram_handle: cleanInstagram
        })
        .eq('user_id', user.id);

      if (error) throw error;

      onUpdate({ twitter_handle: cleanTwitter, instagram_handle: cleanInstagram });
      setIsEditing(false);
      toast({
        title: "Socials updated!",
        description: "Links saved successfully."
      });
    } catch (error: any) {
      toast({
        title: "Update failed",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    setTwitter(twitterHandle || '');
    setInstagram(instagramHandle || '');
    setIsEditing(false);
  };

  return (
    <FeedCard>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-display text-lg text-foreground">SOCIALS</h3>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="p-1 rounded-full hover:bg-muted transition-colors"
          >
            <Pencil className="w-4 h-4 text-muted-foreground" />
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Twitter className="w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Twitter handle"
              value={twitter}
              onChange={(e) => setTwitter(e.target.value)}
              className="bg-muted border-border"
            />
          </div>
          <div className="flex items-center gap-2">
            <Instagram className="w-5 h-5 text-muted-foreground" />
            <Input
              placeholder="Instagram handle"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              className="bg-muted border-border"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              size="sm"
              variant="outline"
              onClick={handleCancel}
              disabled={isSaving}
            >
              <X className="w-4 h-4 mr-1" />
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={isSaving}
            >
              <Check className="w-4 h-4 mr-1" />
              Save
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {twitterHandle ? (
            <a
              href={`https://twitter.com/${twitterHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Twitter className="w-5 h-5" />
              <span>@{twitterHandle}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
          {instagramHandle ? (
            <a
              href={`https://instagram.com/${instagramHandle}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              <Instagram className="w-5 h-5" />
              <span>@{instagramHandle}</span>
              <ExternalLink className="w-3 h-3" />
            </a>
          ) : null}
          {!twitterHandle && !instagramHandle && (
            <p className="text-sm text-muted-foreground">No socials linked yet</p>
          )}
        </div>
      )}
    </FeedCard>
  );
};
