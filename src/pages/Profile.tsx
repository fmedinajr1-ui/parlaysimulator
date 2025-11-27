import { BottomNav } from "@/components/BottomNav";
import { FeedCard } from "@/components/FeedCard";
import { Button } from "@/components/ui/button";
import { Lock, User, Trophy, History, Bell } from "lucide-react";
import { Link } from "react-router-dom";

const Profile = () => {
  return (
    <div className="min-h-screen bg-background pb-24">
      <main className="max-w-lg mx-auto px-4 py-6">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="w-24 h-24 rounded-full gradient-purple mx-auto mb-4 flex items-center justify-center">
            <User className="w-12 h-12 text-foreground" />
          </div>
          <h1 className="font-display text-3xl text-foreground mb-2">
            DEGEN PROFILE
          </h1>
          <p className="text-muted-foreground">
            Coming soon... 🚀
          </p>
        </div>

        {/* Coming Soon Features */}
        <div className="space-y-4">
          <FeedCard className="opacity-60">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                <Trophy className="w-6 h-6 text-neon-yellow" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">Degen Stats</p>
                <p className="text-sm text-muted-foreground">Track your parlay history</p>
              </div>
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
          </FeedCard>

          <FeedCard className="opacity-60">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                <History className="w-6 h-6 text-neon-cyan" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">Slip History</p>
                <p className="text-sm text-muted-foreground">Review past roasts</p>
              </div>
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
          </FeedCard>

          <FeedCard className="opacity-60">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-xl bg-muted flex items-center justify-center">
                <Bell className="w-6 h-6 text-neon-purple" />
              </div>
              <div className="flex-1">
                <p className="font-semibold text-foreground">Alerts</p>
                <p className="text-sm text-muted-foreground">Get notified on your slips</p>
              </div>
              <Lock className="w-5 h-5 text-muted-foreground" />
            </div>
          </FeedCard>
        </div>

        {/* CTA */}
        <div className="mt-8 text-center">
          <p className="text-muted-foreground mb-4">
            For now, keep analyzing those slips! 🔥
          </p>
          <Link to="/upload">
            <Button variant="neon" size="lg" className="font-display">
              🎟️ UPLOAD A SLIP
            </Button>
          </Link>
        </div>
      </main>

      <BottomNav />
    </div>
  );
};

export default Profile;
