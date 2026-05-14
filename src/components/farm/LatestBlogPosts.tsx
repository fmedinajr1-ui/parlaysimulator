import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

interface Post {
  id: string;
  slug: string;
  title: string;
  category: string;
  meta_description: string;
  published_at: string;
}

export function LatestBlogPosts() {
  const [posts, setPosts] = useState<Post[]>([]);

  useEffect(() => {
    supabase
      .from("blog_posts")
      .select("id, slug, title, category, meta_description, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(6)
      .then(({ data }) => setPosts((data || []) as Post[]));
  }, []);

  if (posts.length === 0) return null;

  return (
    <section className="py-16 px-5" id="blog">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-end justify-between mb-8 flex-wrap gap-3">
          <div>
            <h2 className="farm-display text-3xl md:text-4xl text-[hsl(var(--farm-text))]">
              Latest from the Blog
            </h2>
            <p className="text-sm text-[hsl(var(--farm-muted))] mt-2">
              Daily AI-driven betting strategy, prop math, and sharp money breakdowns.
            </p>
          </div>
          <Link
            to="/blog"
            className="text-sm text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))] underline-offset-4 hover:underline"
          >
            View all articles →
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {posts.map((p) => {
            const catSlug = p.category.toLowerCase().replace(/\s+/g, "-");
            return (
              <article
                key={p.id}
                className="rounded-xl border border-[hsl(var(--farm-line))] p-5 hover:border-[hsl(var(--farm-text)/0.3)] transition-colors"
              >
                <Link
                  to={`/blog/category/${catSlug}`}
                  className="text-[10px] uppercase tracking-wider text-[hsl(var(--farm-muted))] hover:text-[hsl(var(--farm-text))]"
                >
                  {p.category}
                </Link>
                <h3 className="farm-display text-lg leading-snug mt-2 text-[hsl(var(--farm-text))]">
                  <Link to={`/blog/${p.slug}`} className="hover:underline underline-offset-4">
                    {p.title}
                  </Link>
                </h3>
                <p className="text-sm text-[hsl(var(--farm-muted))] mt-2 line-clamp-3">
                  {p.meta_description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
