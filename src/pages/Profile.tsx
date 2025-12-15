import { useState, useEffect } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscription } from '@/hooks/useSubscription';
import { usePilotUser } from '@/hooks/usePilotUser';
import { useParlayBuilder } from '@/contexts/ParlayBuilderContext';
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
import { TutorialToggle } from '@/components/tutorial/TutorialToggle';
import { BankrollManager } from '@/components/bankroll/BankrollManager';
import { PilotQuotaCard } from '@/components/PilotQuotaCard';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, LogOut, Upload, Crown, User, Settings, Target, LineChart, GitCompare, Trash2, ChevronDown, BarChart3, Zap, History } from 'lucide-react';
import { toast } from '@/hooks/use-toast';
import { AppShell } from '@/components/layout/AppShell';
import { MobileHeader } from '@/components/layout/MobileHeader';
import { FeedCard } from '@/components/FeedCard';
import { SOURCE_LABELS } from '@/types/universal-parlay';

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
  const { isSubscribed, isAdmin, subscriptionEnd, openCustomerPortal } = useSubscription();
  const { isPilotUser, freeScansRemaining, freeComparesRemaining, paidScanBalance, purchaseScans, creditScans } = usePilotUser();
  const { legs, legCount, combinedOdds, winProbability, analyzeParlay, compareParlay, clearParlay } = useParlayBuilder();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Handle purchase success/cancelled from URL
  useEffect(() => {
    const purchase = searchParams.get('purchase');
    const scans = searchParams.get('scans');
    const restricted = searchParams.get('restricted');

    if (purchase === 'success' && scans) {
      const scanCount = parseInt(scans, 10);
      creditScans(scanCount);
      toast({
        title: "Purchase Successful!",
        description: `${scanCount} scans have been added to your account.`,
      });
      setSearchParams({});
    } else if (purchase === 'cancelled') {
      toast({
        title: "Purchase Cancelled",
        description: "No charges were made.",
        variant: "destructive",
      });
      setSearchParams({});
    } else if (restricted === 'true') {
      toast({
        title: "Feature Locked",
        description: "Purchase more scans to unlock all features.",
        variant: "destructive",
      });
      setSearchParams({});
    }
  }, [searchParams, setSearchParams, creditScans]);

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
        {/* Pilot User Quota Card */}
        {isPilotUser && !isAdmin && !isSubscribed && (
          <PilotQuotaCard
            freeScansRemaining={freeScansRemaining}
            freeComparesRemaining={freeComparesRemaining}
            paidScanBalance={paidScanBalance}
            onPurchase={purchaseScans}
          />
        )}

        {/* Subscription Badge - Only for existing subscribers/admins */}
        {(isSubscribed || isAdmin) && (
          <FeedCard variant="highlight" className="py-3">
            <div className="flex items-center justify-between">
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
              {isSubscribed && !isAdmin && (
                <Button variant="outline" size="sm" onClick={openCustomerPortal}>
                  <Settings className="w-4 h-4" />
                </Button>
              )}
            </div>
          </FeedCard>
        )}

        {/* Active Parlay Builder */}
        {legCount > 0 && (
          <FeedCard className="bg-gradient-to-br from-primary/10 to-primary/5 border-primary/30">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-5 h-5 text-primary" />
              <h3 className="font-display text-lg">Active Parlay</h3>
              <Badge className="ml-auto">{legCount} legs</Badge>
            </div>
            
            <div className="flex flex-wrap gap-1 mb-3">
              {Object.entries(
                legs.reduce((acc, leg) => {
                  acc[leg.source] = (acc[leg.source] || 0) + 1;
                  return acc;
                }, {} as Record<string, number>)
              ).map(([source, count]) => (
                <Badge key={source} variant="outline" className="text-xs">
                  {SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]?.emoji} {count} {SOURCE_LABELS[source as keyof typeof SOURCE_LABELS]?.label}
                </Badge>
              ))}
            </div>

            <div className="flex justify-between text-sm mb-3">
              <span className="text-muted-foreground">Combined Odds</span>
              <span className="font-bold text-primary">
                {combinedOdds > 0 ? `+${combinedOdds}` : combinedOdds}
              </span>
            </div>
            <div className="flex justify-between text-sm mb-4">
              <span className="text-muted-foreground">Win Probability</span>
              <span className="font-bold">{winProbability.toFixed(1)}%</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Button size="sm" variant="outline" onClick={analyzeParlay}>
                <LineChart className="h-3 w-3 mr-1" />
                Analyze
              </Button>
              <Button size="sm" variant="outline" onClick={compareParlay}>
                <GitCompare className="h-3 w-3 mr-1" />
                Compare
              </Button>
              <Button size="sm" variant="destructive" onClick={clearParlay}>
                <Trash2 className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          </FeedCard>
        )}

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

        {/* Bankroll Manager - Prominent placement */}
        <div className="mt-4">
          <BankrollManager />
        </div>

        {/* Stats & Performance Section - Collapsible */}
        <Collapsible defaultOpen={false} className="mt-4">
          <CollapsibleTrigger asChild>
            <FeedCard className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <h3 className="font-display text-lg">Stats & Performance</h3>
                </div>
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </FeedCard>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 mt-4">
            <DegenStats
              totalWins={profile.total_wins}
              totalLosses={profile.total_losses}
              totalStaked={profile.total_staked}
              totalPayout={profile.total_payout}
              lifetimeDegenScore={profile.lifetime_degenerate_score}
            />
            {(isSubscribed || isAdmin) && (
              <AISuggestionsCard userId={user!.id} />
            )}
            <AIPerformanceCard userId={user!.id} />
            <BettingCalendarCard userId={user!.id} />
          </CollapsibleContent>
        </Collapsible>

        {/* Predictions Section - Collapsible */}
        <Collapsible defaultOpen={false} className="mt-4">
          <CollapsibleTrigger asChild>
            <FeedCard className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-neon-orange" />
                  <h3 className="font-display text-lg">Upset Predictions</h3>
                </div>
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </FeedCard>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-4 mt-4">
            <TodaysUpsetPredictions userId={user!.id} />
            <UpsetAccuracyDashboard />
            <UpsetTrackerCard userId={user!.id} />
          </CollapsibleContent>
        </Collapsible>

        {/* Notification Preferences - Pro users only */}
        {(isSubscribed || isAdmin) && (
          <div className="mt-4">
            <NotificationPreferences />
          </div>
        )}

        {/* Hints & Tutorial Settings */}
        <div className="mt-4">
          <FeedCard>
            <h3 className="font-display text-lg mb-3">App Preferences</h3>
            <TutorialToggle />
          </FeedCard>
        </div>

        {/* Parlay History - Collapsible */}
        <Collapsible defaultOpen={false} className="mt-4">
          <CollapsibleTrigger asChild>
            <FeedCard className="cursor-pointer hover:bg-muted/50 transition-colors">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-muted-foreground" />
                  <h3 className="font-display text-lg">Parlay History</h3>
                </div>
                <ChevronDown className="w-5 h-5 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180" />
              </div>
            </FeedCard>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-4">
            <ParlayHistoryFeed onStatsUpdate={fetchProfile} />
          </CollapsibleContent>
        </Collapsible>

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
