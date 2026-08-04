"use client";

import { useCallback, useEffect, useState } from "react";
import { LOOKS, type Look } from "@/data/looks";
import { IntroFlash } from "@/components/IntroFlash";
import { BrandStage } from "@/components/BrandStage";
import { Marquee } from "@/components/Marquee";
import { Runway } from "@/components/Runway";
import { ComingSoonReveal } from "@/components/ComingSoonReveal";
import { SiteFooter } from "@/components/SiteFooter";
import { CustomCursor } from "@/components/CustomCursor";

export default function Home() {
  const [active, setActive] = useState<Look | null>(null);
  const close = useCallback(() => setActive(null), []);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKey);
    };
  }, [active, close]);

  return (
    <>
      <CustomCursor />
      <div className="film-grain" aria-hidden />
      <IntroFlash />
      <main>
        <BrandStage />
        <Marquee />
        <Runway looks={LOOKS} onSelect={setActive} />
      </main>
      <SiteFooter />
      <ComingSoonReveal look={active} onClose={close} />
    </>
  );
}
