// @ts-nocheck
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Seo } from "@/components/seo/Seo";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, ArrowRight, Rss } from "lucide-react";
import { format } from "date-fns";

const CATEGORIES = ["All", "Strategy", "AI Picks", "Prop Analysis", "NBA", "MLB", "Tennis", "MMA"];

interface BlogPost {
  id: string;
  slug: string;
  title: string;
  meta_description: string;
  category: string;
  tags: string[];
  hero_image_url: string | null;
  published_at: string;
}

export default function BlogIndex() {
  const [posts, setPosts] = useState<BlogPost[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");

  useEffect(() => {
    let q = supabase
      .from("blog_posts")
      .select("id, slug, title, meta_description, category, tags, hero_image_url, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(60);
    if (activeCategory !== "All") q = q.eq("category", activeCategory);
    q.then(({ data }) => {
      setPosts((data || []) as BlogPost[]);
      setLoading(false);
    });
  }, [activeCategory]);

  const blogJsonLd = {
    "@context": "https://schema.org",
    "@type": "Blog",
    name: "ParlayFarm Blog",
    url: "https://parlayfarm.com/blog",
    description:
      "AI-powered sports betting strategy, prop analysis, MVP races, injury updates, and statistical edges.",
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Seo
        title="ParlayFarm Blog — AI Sports Betting Strategy & Insights"
        description="Daily AI-driven sports betting insights: winning strategies, player props, MVP races, injury impact, L10 stats, and how AI exposes rigged-looking lines."
        canonical="https://parlayfarm.com/blog"
        jsonLd={blogJsonLd}
      />

      <header className="border-b border-border/40 bg-card/30 backdrop-blur">
        <div className="container mx-auto px-4 py-12 max-w-6xl">
          <Link to="/" className="text-sm text-muted-foreground hover:text-foreground">
            ← Back to ParlayFarm
          </Link>
          <h1 className="text-4xl md:text-5xl font-bold mt-4 tracking-tight">
            The ParlayFarm Blog
          </h1>
          <p className="text-lg text-muted-foreground mt-3 max-w-2xl">
            AI-powered sports betting analysis. Real signals. No hot takes. Daily insights into
            winning, prop math, MVP races, injury fallout, and what the books don&apos;t want you to see.
          </p>
          <div className="flex items-center gap-2 mt-4">
            <Button asChild variant="outline" size="sm">
              <a href="/rss.xml" target="_blank" rel="noopener noreferrer">
                <Rss className="w-4 h-4 mr-2" /> RSS Feed
              </a>
            </Button>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-8 max-w-6xl">
        <div className="flex flex-wrap gap-2 mb-8">
          {CATEGORIES.map((cat) => (
            <Button
              key={cat}
              variant={activeCategory === cat ? "default" : "outline"}
              size="sm"
              onClick={() => setActiveCategory(cat)}
            >
              {cat}
            </Button>
          ))}
        </div>

        {loading ? (
          <div className="text-center py-16 text-muted-foreground">Loading articles…</div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-muted-foreground">No posts published yet in this category.</p>
            <p className="text-sm text-muted-foreground mt-2">Check back soon — new posts daily.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {posts.map((post) => (
              <Link key={post.id} to={`/blog/${post.slug}`} className="group">
                <Card className="h-full hover:border-primary/60 transition-all hover:shadow-lg hover:shadow-primary/10">
                  <CardContent className="p-6">
                    <Badge variant="secondary" className="mb-3">
                      {post.category}
                    </Badge>
                    <h2 className="text-xl font-bold leading-tight mb-2 group-hover:text-primary transition-colors line-clamp-3">
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
