// @ts-nocheck
import { useEffect, useState } from "react";
import { useParams, Link, Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/seo/Seo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, ArrowRight, ArrowLeft } from "lucide-react";
import { format } from "date-fns";

const CATEGORY_MAP: Record<string, string> = {
  strategy: "Strategy",
  "ai-picks": "AI Picks",
  "prop-analysis": "Prop Analysis",
  nba: "NBA",
  mlb: "MLB",
  tennis: "Tennis",
  mma: "MMA",
};

export default function BlogCategory() {
  const { cat } = useParams<{ cat: string }>();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const categoryName = cat ? CATEGORY_MAP[cat.toLowerCase()] : null;

  useEffect(() => {
    if (!categoryName) {
      setLoading(false);
      return;
    }
    supabase
      .from("blog_posts")
      .select("id, slug, title, meta_description, category, published_at")
      .eq("status", "published")
      .eq("category", categoryName)
      .order("published_at", { ascending: false })
      .limit(60)
      .then(({ data }) => {
        setPosts(data || []);
        setLoading(false);
      });
  }, [categoryName]);

  if (!categoryName) return <Navigate to="/blog" replace />;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title={`${categoryName} — ParlayFarm Blog`}
        description={`AI-driven sports betting articles in ${categoryName}: winning angles, player updates, statistical edges, and prop analysis.`}
        canonical={`https://parlayfarm.com/blog/category/${cat}`}
      />

      <div className="container mx-auto px-4 py-12 max-w-6xl">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6"
        >
          <ArrowLeft className="w-4 h-4" /> All Articles
        </Link>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{categoryName}</h1>
        <p className="text-muted-foreground mt-3">
          AI-powered insights and analysis in {categoryName}.
        </p>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading…</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            No articles in this category yet.
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3 mt-8">
            {posts.map((post) => (
              <Link key={post.id} to={`/blog/${post.slug}`} className="group">
                <Card className="h-full hover:border-primary/60 transition-all">
                  <CardContent className="p-6">
                    <Badge variant="secondary" className="mb-3">
                      {post.category}
                    </Badge>
                    <h2 className="text-xl font-bold leading-tight mb-2 group-hover:text-primary line-clamp-3">
                      {post.title}
                    </h2>
                    <p className="text-sm text-muted-foreground line-clamp-3 mb-4">
                      {post.meta_description}
                    </p>
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="w-3 h-3" />
                        {format(new Date(post.published_at), "MMM d, yyyy")}
                      </span>
                      <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
