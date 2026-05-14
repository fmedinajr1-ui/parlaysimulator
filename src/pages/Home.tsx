import { useState } from "react";
import "@/components/farm/farm-tokens.css";
import { FarmNav } from "@/components/farm/FarmNav";
import { FarmHero } from "@/components/farm/FarmHero";
import { Steps } from "@/components/farm/Steps";
import { SharpTracker } from "@/components/farm/SharpTracker";
import { SlipDemo } from "@/components/farm/SlipDemo";
import { FeatureGrid } from "@/components/farm/FeatureGrid";
import { TopDogReel } from "@/components/farm/TopDogReel";
import { UploadForm } from "@/components/farm/UploadForm";
import { FarmPricing } from "@/components/farm/FarmPricing";
import { FinalCTA } from "@/components/farm/FinalCTA";
import { FarmFooter } from "@/components/farm/FarmFooter";
import { LatestBlogPosts } from "@/components/farm/LatestBlogPosts";
import { StickyMobileBar } from "@/components/farm/StickyMobileBar";
import { EmailCaptureModal, type FarmTier } from "@/components/farm/EmailCaptureModal";
import { SpikePromoPopover } from "@/components/farm/SpikePromoPopover";
import { Seo } from "@/components/seo/Seo";

export default function Home() {
  const [modalTier, setModalTier] = useState<FarmTier | null>(null);

  const openJoin = () => setModalTier("all_access");
  const openUpload = () => {
    document.getElementById("upload")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="farm-theme min-h-screen pb-24 md:pb-0">
      <Seo
        title="Parlay Farm - AI Sports Betting Analysis & Parlay Optimizer"
        description="Upload your parlay slip for AI analysis, track sharp money movement, and discover data-driven betting strategies. Free parlay calculator and real-time odds tracking."
        canonical="https://parlayfarm.com/"
        jsonLd={{
          "@context": "https://schema.org",
          "@type": "WebPage",
          name: "Parlay Farm - AI Sports Betting Analysis",
          description: "AI-powered parlay analysis, sharp money tracking, and betting strategy optimization.",
          url: "https://parlayfarm.com/",
          mainEntity: {
            "@type": "SoftwareApplication",
            name: "Parlay Farm",
            applicationCategory: "SportsApplication",
            operatingSystem: "Web"
          }
        }}
      />
      <FarmNav onCtaClick={openJoin} />
      <FarmHero onJoin={openJoin} onUpload={openUpload} />
      <Steps />
      <SharpTracker />
      <SlipDemo />
      <FeatureGrid />
      <TopDogReel />
      <UploadForm />
      <FarmPricing onSelect={setModalTier} />
      <LatestBlogPosts />
      <FinalCTA onJoin={openJoin} />
      <FarmFooter />
      <StickyMobileBar onJoin={openJoin} onUpload={openUpload} />
      <EmailCaptureModal open={!!modalTier} tier={modalTier} onClose={() => setModalTier(null)} />
      <SpikePromoPopover />
    </div>
  );
}
