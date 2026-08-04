"use client";

import Image from "next/image";
import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";

export function BrandStage() {
  const ref = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });
  const y = useTransform(scrollYProgress, [0, 1], ["0%", "28%"]);
  const opacity = useTransform(scrollYProgress, [0, 0.75], [1, 0]);
  const scale = useTransform(scrollYProgress, [0, 1], [1, 1.08]);

  return (
    <section
      ref={ref}
      className="relative flex min-h-[100svh] flex-col justify-between overflow-hidden px-5 pb-8 pt-6 sm:px-8 lg:px-12"
    >
      <div className="relative z-20 flex items-start justify-between gap-4">
        <Image
          src="/kqs-logo.png"
          alt="KQS"
          width={48}
          height={48}
          className="h-12 w-12 rounded-full object-cover"
          priority
          data-cursor="hot"
        />
        <p className="max-w-[14ch] text-right text-[11px] font-medium uppercase leading-relaxed tracking-[0.22em] text-mute">
          Apparel
          <br />
          Footwear
          <br />
          Lesotho
        </p>
      </div>

      <motion.div style={{ y, opacity, scale }} className="relative z-10 py-16 sm:py-20">
        <p className="text-[11px] font-semibold uppercase tracking-[0.4em] text-signal">
          Unreleased · Season 01
        </p>
        <h1 className="display mt-4 max-w-[10ch] text-[clamp(3.8rem,14vw,9.5rem)] text-ink">
          Standard
          <br />
          <span className="outline-type text-ink">not</span> trend
        </h1>
        <p className="serif mt-8 max-w-[28ch] text-[clamp(1.35rem,2.8vw,2rem)] leading-snug text-ink">
          Premium street. Obsessive detail. Built to look like nobody else in the kingdom.
        </p>
      </motion.div>

      <div className="relative z-20 flex items-end justify-between gap-4">
        <motion.p
          className="text-[11px] uppercase tracking-[0.28em] text-mute"
          animate={{ opacity: [0.35, 1, 0.35] }}
          transition={{ duration: 2.4, repeat: Infinity }}
        >
          Scroll the runway →
        </motion.p>
        <p className="serif text-lg italic text-ink sm:text-xl">KQS Footware</p>
      </div>

      {/* Architecture type — floats behind */}
      <div
        className="pointer-events-none absolute -right-[8%] top-[18%] z-0 select-none display text-[clamp(8rem,28vw,22rem)] leading-none text-ink/[0.05]"
        aria-hidden
      >
        KQS
      </div>
      <div
        className="pointer-events-none absolute -left-[4%] bottom-[8%] z-0 rotate-[-90deg] origin-bottom-left select-none text-[11px] font-semibold uppercase tracking-[0.6em] text-ink/20"
        aria-hidden
      >
        Kabeli Quality Shoes
      </div>
    </section>
  );
}
