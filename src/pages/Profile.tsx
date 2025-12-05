import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { ProfileHeader } from '@/components/profile/ProfileHeader';
import { SocialLinks } from '@/components/profile/SocialLinks';
import { DegenStats } from '@/components/profile/DegenStats';
import { ParlayHistoryFeed } from '@/components/profile/ParlayHistoryFeed';
import { AIPerformanceCard } from '@/components/profile/AIPerformanceCard';
import { AISuggestionsCard } from '@/components/profile/AISuggestionsCard';
import { BettingCalendarCard } from '@/components/profile/BettingCalendarCard';
import { UpsetTrackerCard } from '@/components/profile/UpsetTrackerCard';
import { TodaysUpsetPredictions } from '@/components/profile/TodaysUpsetPredictions';
import { UpsetAccuracyDashboard } from '@/components/profile/UpsetAccuracyDashboard';
import { NotificationPreferences } from '@/components/profile/NotificationPreferences';
import { Button } from '@/components/ui/button';
import { Loader2, LogOut, Upload, CreditCard, Crown, User, Settings } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { AppShell } from '@/components/layout/AppShell';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { FeedCard } from '@/components/FeedCard';

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
  const { isSubscribed, isAdmin, subscriptionEnd, openCustomerPortal, startCheckout } = useSubscription();
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
    <AppShell noPadding>
      <MobileHeader 
        title="Profile"
        icon={<User className="w-5 h-5" />}
        rightAction={
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={handleSignOut}
            className="h-9 w-9 text-muted-foreground"
          >
            <LogOut className="w-4 h-4" />
          </Button>
        }
      />

      <div className="px-4 py-4 space-y-4">
        {/* Subscription Badge */}
        <FeedCard variant="highlight" className="py-3">
          <div className="flex items-center justify-between">
            {(isSubscribed || isAdmin) ? (
              <div className="flex items-center gap-3">
                <div className="icon-container">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">
                    {isAdmin ? 'Admin Access' : 'Pro Member'}
                  </p>
                  {subscriptionEnd && !isAdmin && (
                    <p className="text-xs text-muted-foreground">
                      Renews {new Date(subscriptionEnd).toLocaleDateString()}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <div className="icon-container bg-neon-orange/10 text-neon-orange">
                  <Crown className="w-5 h-5" />
                </div>
                <div>
                  <p className="font-semibold text-foreground">Free Plan</p>
                  <p className="text-xs text-muted-foreground">Upgrade for unlimited access</p>
                </div>
              </div>
            )}
            {!isSubscribed && !isAdmin ? (
              <Button onClick={startCheckout} size="sm" className="gradient-fire">
                Upgrade
              </Button>
            ) : isSubscribed && !isAdmin ? (
              <Button variant="outline" size="sm" onClick={openCustomerPortal}>
                <Settings className="w-4 h-4" />
              </Button>
            ) : null}
          </div>
        </FeedCard>

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

        {/* AI Suggestions - Pro users only */}
        {(isSubscribed || isAdmin) && (
          <div className="mt-4">
            <AISuggestionsCard userId={user!.id} />
          </div>
        )}

        {/* AI Performance */}
        <div className="mt-4">
          <AIPerformanceCard userId={user!.id} />
        </div>

        {/* Smart Betting Calendar */}
        <div className="mt-4">
          <BettingCalendarCard userId={user!.id} />
        </div>

        {/* Today's Upset Predictions */}
        <div className="mt-4">
          <TodaysUpsetPredictions userId={user!.id} />
        </div>

        {/* Upset Prediction Accuracy */}
        <div className="mt-4">
          <UpsetAccuracyDashboard />
        </div>

        {/* Upset Tracker */}
        <div className="mt-4">
          <UpsetTrackerCard userId={user!.id} />
        </div>

        {/* Notification Preferences - Pro users only */}
        {(isSubscribed || isAdmin) && (
          <div className="mt-4">
            <NotificationPreferences />
          </div>
        )}

        {/* Parlay History */}
        <div className="mt-4">
          <ParlayHistoryFeed onStatsUpdate={fetchProfile} />
        </div>

        {/* CTA */}
        <div className="mt-6 mb-4">
          <Link to="/upload" className="block">
            <Button variant="neon" size="lg" className="w-full font-display h-14 text-lg">
              <Upload className="w-5 h-5 mr-2" />
              UPLOAD A SLIP
            </Button>
          </Link>
        </div>
      </div>
    </AppShell>
  );
};

export default Profile;
