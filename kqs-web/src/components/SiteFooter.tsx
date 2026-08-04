"use client";

import { motion } from "framer-motion";

export function SiteFooter() {
  const year = new Date().getFullYear();

  return (
    <footer className="relative overflow-hidden bg-bone px-5 py-20 sm:px-8 lg:px-12">
      <p
        className="pointer-events-none absolute -bottom-8 left-0 display select-none text-[clamp(4rem,18vw,12rem)] leading-none text-ink/[0.06]"
        aria-hidden
      >
        KQS
      </p>
      <div className="relative z-10 mx-auto flex max-w-6xl flex-col gap-10 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <motion.p
            className="display text-[clamp(2.2rem,5vw,3.8rem)] text-ink"
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            Built by
            <br />
            obsession.
          </motion.p>
          <p className="serif mt-5 max-w-[28ch] text-xl italic text-ink/70">
            Not a template. A statement from Lesotho.
          </p>
        </div>
        <p className="text-[11px] uppercase tracking-[0.22em] text-mute">
          © {year} Kabeli Quality Shoes
        </p>
      </div>
    </footer>
  );
}
