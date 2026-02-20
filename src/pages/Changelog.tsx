import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Sparkles, Bug, Wrench, Rocket } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { format } from "date-fns";

interface Release {
  id: string;
  version: string;
  title: string;
  summary: string;
  body: string | null;
  release_type: string;
  published_at: string | null;
  created_at: string;
}

const releaseTypeConfig = {
  major: { icon: Rocket, label: "Major", className: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
  feature: { icon: Sparkles, label: "Feature", className: "bg-green-500/20 text-green-400 border-green-500/30" },
  improvement: { icon: Wrench, label: "Improvement", className: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  bugfix: { icon: Bug, label: "Bug Fix", className: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
};

export default function Changelog() {
  const { data: releases, isLoading } = useQuery({
    queryKey: ['app-releases'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('app_releases')
        .select('*')
        .eq('is_published', true)
        .order('published_at', { ascending: false });
      
      if (error) throw error;
      return data as Release[];
    },
  });

  return (
    <div className="min-h-screen bg-background pb-6">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/80 backdrop-blur-xl border-b border-border/50">
        <div className="max-w-2xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="p-2 -ml-2 hover:bg-muted/50 rounded-lg transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-lg font-display font-bold">Changelog</h1>
              <p className="text-xs text-muted-foreground">What's new in Parlay Farm</p>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="bg-card/50 rounded-xl border border-border/50 p-6 space-y-4">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-8 w-3/4" />
              <Skeleton className="h-20 w-full" />
            </div>
          ))
        ) : releases?.length === 0 ? (
          <div className="text-center py-12">
            <Sparkles className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <h2 className="text-lg font-medium mb-2">No releases yet</h2>
            <p className="text-sm text-muted-foreground">Check back soon for updates!</p>
          </div>
        ) : (
          releases?.map((release) => {
            const config = releaseTypeConfig[release.release_type as keyof typeof releaseTypeConfig] || releaseTypeConfig.feature;
            const Icon = config.icon;
            const date = release.published_at || release.created_at;

            return (
              <article 
                key={release.id} 
                className="bg-card/50 rounded-xl border border-border/50 overflow-hidden"
              >
                <div className="p-6 space-y-4">
                  {/* Header */}
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <Badge variant="outline" className={config.className}>
                        <Icon className="w-3 h-3 mr-1" />
                        {config.label}
                      </Badge>
                      <span className="text-sm text-muted-foreground font-mono">
                        v{release.version}
                      </span>
                    </div>
                    <time className="text-xs text-muted-foreground">
                      {format(new Date(date), 'MMM d, yyyy')}
                    </time>
                  </div>

                  {/* Title */}
                  <h2 className="text-xl font-semibold text-foreground">
                    {release.title}
                  </h2>

                  {/* Summary */}
                  <p className="text-muted-foreground leading-relaxed">
                    {release.summary}
                  </p>

                  {/* Body */}
                  {release.body && (
                    <div className="pt-4 border-t border-border/50">
                      <div className="prose prose-sm prose-invert max-w-none">
                        {release.body.split('\n').map((line, i) => (
                          <p key={i} className="text-sm text-muted-foreground mb-2">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </article>
            );
          })
        )}
      </div>
    </div>
  );
}
