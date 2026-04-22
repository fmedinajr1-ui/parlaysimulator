import { Helmet } from "react-helmet";

interface SeoProps {
  title: string;
  description: string;
  canonical: string;
  ogImage?: string;
  type?: "website" | "article";
  publishedTime?: string;
  jsonLd?: Record<string, unknown> | Record<string, unknown>[];
}

export function Seo({
  title,
  description,
  canonical,
  ogImage = "https://parlayfarm.com/parlay-farm-logo.png",
  type = "website",
  publishedTime,
  jsonLd,
}: SeoProps) {
  const ldArray = Array.isArray(jsonLd) ? jsonLd : jsonLd ? [jsonLd] : [];
  return (
    <Helmet>
      <title>{title}</title>
      <meta name="description" content={description} />
      <link rel="canonical" href={canonical} />
      <meta property="og:title" content={title} />
      <meta property="og:description" content={description} />
      <meta property="og:type" content={type} />
      <meta property="og:url" content={canonical} />
      <meta property="og:image" content={ogImage} />
      <meta name="twitter:card" content="summary_large_image" />
      <meta name="twitter:title" content={title} />
      <meta name="twitter:description" content={description} />
      <meta name="twitter:image" content={ogImage} />
      {publishedTime && (
        <meta property="article:published_time" content={publishedTime} />
      )}
      {ldArray.map((ld, i) => (
        <script type="application/ld+json" key={i}>
          {JSON.stringify(ld)}
        </script>
      ))}
    </Helmet>
  );
}
