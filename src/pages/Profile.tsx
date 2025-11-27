import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { BottomNav } from '@/components/BottomNav';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { SocialLinks } from '@/components/profile/SocialLinks';
import { DegenStats } from '@/components/profile/DegenStats';
import { ParlayHistoryFeed } from '@/components/profile/ParlayHistoryFeed';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, Upload } from 'lucide-react';
import { toast } from '@/hooks/use-toast';

interface Profile {
  username: string | null;
  bio: string | null;
  avatar_url: string | null;
  twitter_handle: string | null;
  instagram_handle: string | null;
  total_wins: number;
  total_losses: number;
  total_staked: number;
  total_payout: number;
  lifetime_degenerate_score: number;
}

const Profile = () => {
  const { user, isLoading: authLoading, signOut } = useAuth();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !user) {
      navigate('/auth');
    }
  }, [user, authLoading, navigate]);

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;

    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('user_id', user.id)
        .maybeSingle();

      if (error) throw error;
      
      if (data) {
        setProfile({
          username: data.username,
          bio: data.bio,
          avatar_url: data.avatar_url,
          twitter_handle: data.twitter_handle,
          instagram_handle: data.instagram_handle,
          total_wins: data.total_wins,
          total_losses: data.total_losses,
          total_staked: Number(data.total_staked),
          total_payout: Number(data.total_payout),
          lifetime_degenerate_score: Number(data.lifetime_degenerate_score)
        });
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleProfileUpdate = (updates: Partial<Profile>) => {
    if (profile) {
      setProfile({ ...profile, ...updates });
    }
  };

  const handleSignOut = async () => {
    await signOut();
    toast({
      title: "Signed out",
      description: "See you next time, degen!"
    });
    navigate('/');
  };

  if (authLoading || isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Failed to load profile</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-24">
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Logout button */}
        <div className="flex justify-end mb-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSignOut}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="w-4 h-4 mr-2" />
            Sign out
          </Button>
        </div>

        {/* Profile Header */}
        <ProfileHeader 
          profile={profile} 
          onUpdate={handleProfileUpdate}
        />

        {/* Social Links */}
        <div className="mt-6">
          <SocialLinks
            twitterHandle={profile.twitter_handle}
            instagramHandle={profile.instagram_handle}
            onUpdate={(updates) => handleProfileUpdate(updates as Partial<Profile>)}
          />
        </div>

        {/* Degen Stats */}
        <div className="mt-4">
          <DegenStats
            totalWins={profile.total_wins}
            totalLosses={profile.total_losses}
            totalStaked={profile.total_staked}
            totalPayout={profile.total_payout}
            lifetimeDegenScore={profile.lifetime_degenerate_score}
          />
        </div>

        {/* Parlay History */}
        <div className="mt-4">
          <ParlayHistoryFeed onStatsUpdate={fetchProfile} />
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          <Link to="/upload">
            <Button variant="neon" size="lg" className="font-display">
              <Upload className="w-4 h-4 mr-2" />
              UPLOAD A SLIP
            </Button>
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default Profile;
