"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";

export function IntroFlash() {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = window.setTimeout(() => setShow(false), 2200);
    return () => window.clearTimeout(t);
  }, []);

  return (
    <AnimatePresence>
      {show ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center overflow-hidden bg-signal"
          initial={{ clipPath: "inset(0 0 0% 0)" }}
          exit={{ clipPath: "inset(0 0 100% 0)" }}
          transition={{ duration: 0.85, ease: [0.76, 0, 0.24, 1] }}
          aria-hidden
        >
          <div className="relative flex flex-col items-center px-6 text-center">
            <motion.p
              className="text-[11px] font-semibold uppercase tracking-[0.55em] text-bone/70"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
            >
              Lesotho · 2030 energy
            </motion.p>
            <motion.h1
              className="display mt-6 text-[clamp(4.5rem,18vw,11rem)] text-bone"
              initial={{ opacity: 0, scale: 1.12, y: 30 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              transition={{ delay: 0.25, duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
            >
              KQS
            </motion.h1>
            <motion.p
              className="serif mt-4 text-[clamp(1.25rem,3vw,2rem)] italic text-bone"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.7 }}
            >
              the standard arrives late on purpose
            </motion.p>
          </div>
          <motion.div
            className="absolute bottom-0 left-0 h-1 origin-left bg-bone"
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1.9, ease: "linear" }}
            style={{ width: "100%" }}
          />
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
