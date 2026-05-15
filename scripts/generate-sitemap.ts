// Build-time sitemap generator. Writes public/sitemap.xml.
import { writeFileSync } from "fs";
import { resolve } from "path";

const BASE_URL = "https://parlayfarm.com";
const SUPABASE_URL = "https://pajakaqphlxoqjtrxzmi.supabase.co";
const SUPABASE_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBhamFrYXFwaGx4b3FqdHJ4em1pIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQyNjIzNDcsImV4cCI6MjA3OTgzODM0N30.xeQu6cDtWz8GjVaG1EhMqNZUhYkn1Yq6L9z4dop03co";

const staticUrls = [
  { path: "/", priority: "1.0", changefreq: "daily" },
  { path: "/blog", priority: "0.9", changefreq: "daily" },
];

type Post = { slug: string; updated_at: string | null; category: string | null };

async function fetchPosts(): Promise<Post[]> {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/blog_posts?select=slug,updated_at,category&status=eq.published&order=published_at.desc`,
      {
        headers: {
          apikey: SUPABASE_ANON,
          Authorization: `Bearer ${SUPABASE_ANON}`,
        },
      },
    );
    if (!res.ok) {
      console.warn(`[sitemap] blog fetch failed: ${res.status}`);
      return [];
    }
    return (await res.json()) as Post[];
  } catch (e) {
    console.warn(`[sitemap] blog fetch error:`, e);
    return [];
  }
}

function urlEntry(loc: string, lastmod: string, changefreq: string, priority: string) {
  return `  <url><loc>${loc}</loc><lastmod>${lastmod}</lastmod><changefreq>${changefreq}</changefreq><priority>${priority}</priority></url>`;
}

async function main() {
  const today = new Date().toISOString().split("T")[0];
  const posts = await fetchPosts();
  const cats = Array.from(
    new Set(posts.map((p) => p.category).filter((c): c is string => !!c)),
  );

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
  ];
  for (const u of staticUrls) {
    lines.push(urlEntry(`${BASE_URL}${u.path}`, today, u.changefreq, u.priority));
  }
  for (const cat of cats) {
    const slug = cat.toLowerCase().replace(/\s+/g, "-");
    lines.push(urlEntry(`${BASE_URL}/blog/category/${slug}`, today, "weekly", "0.7"));
  }
  for (const p of posts) {
    const lastmod = (p.updated_at || today).split("T")[0];
    lines.push(urlEntry(`${BASE_URL}/blog/${p.slug}`, lastmod, "weekly", "0.6"));
  }
  lines.push(`</urlset>`);

  writeFileSync(resolve("public/sitemap.xml"), lines.join("\n"));
  console.log(`[sitemap] wrote ${staticUrls.length + cats.length + posts.length} entries`);
}

main();