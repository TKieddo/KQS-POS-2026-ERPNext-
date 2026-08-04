"use client";

import Image from "next/image";
import { AnimatePresence, motion } from "framer-motion";
import type { Look } from "@/data/looks";

type Props = {
  look: Look | null;
  onClose: () => void;
};

export function ComingSoonReveal({ look, onClose }: Props) {
  return (
    <AnimatePresence>
      {look ? (
        <motion.div
          className="fixed inset-0 z-[80] bg-ink"
          role="dialog"
          aria-modal="true"
          aria-labelledby="soon-title"
          initial={{ clipPath: "circle(0% at 50% 50%)" }}
          animate={{ clipPath: "circle(150% at 50% 50%)" }}
          exit={{ clipPath: "circle(0% at 50% 50%)" }}
          transition={{ duration: 0.7, ease: [0.76, 0, 0.24, 1] }}
        >
          <button
            type="button"
            data-cursor="hot"
            onClick={onClose}
            className="absolute right-5 top-5 z-20 text-[11px] font-semibold uppercase tracking-[0.3em] text-bone/70 transition hover:text-signal sm:right-8 sm:top-8"
          >
            Close
          </button>

          <div className="grid h-full lg:grid-cols-2">
            <div className="relative h-[45vh] w-full lg:h-full lg:min-h-full">
              <Image
                src={look.image}
                alt={look.name}
                fill
                className="object-cover"
                style={{ objectPosition: look.focus ?? "center" }}
                sizes="(max-width: 1024px) 100vw, 50vw"
                priority
              />
              <div className="absolute inset-0 bg-gradient-to-t from-ink via-transparent to-transparent lg:bg-gradient-to-r lg:from-transparent lg:to-ink/40" />
              <p className="display absolute left-5 top-1/2 -translate-y-1/2 text-[clamp(5rem,18vw,12rem)] text-bone/15 lg:left-8">
                {look.index}
              </p>
            </div>

            <div className="relative flex flex-col justify-center px-6 py-10 sm:px-12 lg:px-16">
              <motion.p
                className="text-[11px] font-semibold uppercase tracking-[0.4em] text-signal"
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                Unreleased
              </motion.p>
              <motion.h2
                id="soon-title"
                className="display mt-5 text-[clamp(2.8rem,7vw,5rem)] text-bone"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.32 }}
              >
                {look.name}
              </motion.h2>
              <motion.p
                className="serif mt-8 max-w-[22ch] text-[clamp(1.5rem,3vw,2.25rem)] italic leading-snug text-bone"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.42 }}
              >
                {look.line}
              </motion.p>
              <motion.p
                className="mt-5 max-w-md text-sm leading-relaxed text-bone/50"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.55 }}
              >
                {look.whisper}
              </motion.p>

              <motion.div
                className="mt-12"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.65 }}
              >
                <button
                  type="button"
                  data-cursor="hot"
                  onClick={onClose}
                  className="border border-bone/25 px-8 py-4 text-[11px] font-semibold uppercase tracking-[0.28em] text-bone transition hover:border-signal hover:bg-signal hover:text-bone"
                >
                  Back to runway
                </button>
              </motion.div>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
