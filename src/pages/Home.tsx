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
import { StickyMobileBar } from "@/components/farm/StickyMobileBar";
import { EmailCaptureModal, type FarmTier } from "@/components/farm/EmailCaptureModal";

export default function Home() {
  const [modalTier, setModalTier] = useState<FarmTier | null>(null);

  const openJoin = () => setModalTier("top_dog");
  const openUpload = () => {
    document.getElementById("upload")?.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <div className="farm-theme min-h-screen pb-24 md:pb-0">
      <FarmNav onCtaClick={openJoin} />
      <FarmHero onJoin={openJoin} onUpload={openUpload} />
      <Steps />
      <SharpTracker />
      <SlipDemo />
      <FeatureGrid />
      <TopDogReel />
      <UploadForm />
      <FarmPricing onSelect={setModalTier} />
      <FinalCTA onJoin={openJoin} />
      <FarmFooter />
      <StickyMobileBar onJoin={openJoin} onUpload={openUpload} />
      <EmailCaptureModal open={!!modalTier} tier={modalTier} onClose={() => setModalTier(null)} />
    </div>
  );
}
