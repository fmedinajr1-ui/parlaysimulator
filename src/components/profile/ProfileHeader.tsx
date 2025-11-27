import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { AvatarUpload } from './AvatarUpload';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Pencil, Check, X } from 'lucide-react';

interface Profile {
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
}

interface ProfileHeaderProps {
  profile: Profile;
  onUpdate: (updates: Partial<Profile>) => void;
}

export const ProfileHeader = ({ profile, onUpdate }: ProfileHeaderProps) => {
  const { user } = useAuth();
  const [isEditing, setIsEditing] = useState(false);
  const [username, setUsername] = useState(profile.username || '');
  const [bio, setBio] = useState(profile.bio || '');
  const [isSaving, setIsSaving] = useState(false);

  const handleSave = async () => {
    if (!user) return;
    setIsSaving(true);

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          username: username.trim() || null,
          bio: bio.trim() || null
        })
        .eq('user_id', user.id);

      if (error) {
        if (error.message.includes('unique constraint')) {
          toast({
            title: "Username taken",
            description: "Try a different username.",
            variant: "destructive"
          });
          return;
        }
        throw error;
      }

      onUpdate({ username: username.trim() || null, bio: bio.trim() || null });
      setIsEditing(false);
      toast({
        title: "Profile updated!",
        description: "Changes saved successfully."
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
    setUsername(profile.username || '');
    setBio(profile.bio || '');
    setIsEditing(false);
  };

  return (
    <div className="flex flex-col items-center text-center">
      <AvatarUpload 
        avatarUrl={profile.avatar_url} 
        onUpload={(url) => onUpdate({ avatar_url: url })} 
      />

      <div className="mt-4 w-full max-w-sm">
        {isEditing ? (
          <div className="space-y-3">
            <Input
              placeholder="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              maxLength={30}
              className="text-center bg-card border-border"
            />
            <Textarea
              placeholder="Bio (max 280 chars)"
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={280}
              rows={2}
              className="text-center bg-card border-border resize-none"
            />
            <div className="flex gap-2 justify-center">
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
          <>
            <div className="flex items-center justify-center gap-2">
              <h1 className="font-display text-2xl text-foreground">
                {profile.username || 'Anonymous Degen'}
              </h1>
              <button
                onClick={() => setIsEditing(true)}
                className="p-1 rounded-full hover:bg-muted transition-colors"
              >
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
            {profile.bio && (
              <p className="text-muted-foreground mt-1">{profile.bio}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
};
