"use client";

import Image from "next/image";
import { motion, useScroll, useSpring, useTransform } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import type { Look } from "@/data/looks";

type Props = {
  looks: Look[];
  onSelect: (look: Look) => void;
};

export function Runway({ looks, onSelect }: Props) {
  const wrap = useRef<HTMLElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [travel, setTravel] = useState(0);

  useEffect(() => {
    const el = track.current;
    if (!el) return;

    const measure = () => {
      const w = el.scrollWidth - window.innerWidth;
      setTravel(Math.max(w, 0));
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    window.addEventListener("resize", measure);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [looks]);

  const { scrollYProgress } = useScroll({
    target: wrap,
    offset: ["start start", "end end"],
  });

  const rawX = useTransform(scrollYProgress, [0, 1], [0, -travel]);
  const x = useSpring(rawX, { stiffness: 90, damping: 28, mass: 0.35 });
  const progressW = useTransform(scrollYProgress, [0, 1], ["0%", "100%"]);

  return (
    <section
      ref={wrap}
      className="relative bg-ink"
      style={{ height: `${Math.max(looks.length * 85, 280)}vh` }}
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        <div className="absolute left-5 top-5 z-30 sm:left-8 sm:top-7">
          <p className="text-[10px] font-semibold uppercase tracking-[0.35em] text-bone/45">
            Runway · drag with scroll
          </p>
          <div className="mt-3 h-px w-40 overflow-hidden bg-bone/15 sm:w-56">
            <motion.div className="h-full bg-signal" style={{ width: progressW }} />
          </div>
        </div>

        <p
          className="pointer-events-none absolute bottom-6 left-5 z-30 rotate-[-90deg] origin-bottom-left text-[10px] font-semibold uppercase tracking-[0.45em] text-bone/35 sm:left-8"
          aria-hidden
        >
          Tap a look — unreleased
        </p>

        <motion.div ref={track} style={{ x }} className="flex h-full items-center gap-6 px-8 sm:gap-10 sm:px-16">
          {looks.map((look, i) => (
            <motion.button
              key={look.id}
              type="button"
              data-cursor="hot"
              onClick={() => onSelect(look)}
              className="group relative h-[min(72svh,720px)] min-h-[420px] w-[min(78vw,420px)] shrink-0 overflow-hidden rounded-none text-left sm:w-[min(52vw,520px)]"
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, amount: 0.4 }}
              transition={{ duration: 0.6, delay: Math.min(i * 0.04, 0.2) }}
            >
              <div
                className={`runway-clip relative h-full w-full ${look.tone === "dark" ? "bg-[#151515]" : "bg-fog"}`}
              >
                <Image
                  src={look.image}
                  alt={look.name}
                  fill
                  className="object-cover transition duration-[1100ms] ease-out group-hover:scale-[1.06]"
                  style={{ objectPosition: look.focus ?? "center" }}
                  sizes="(max-width: 900px) 80vw, 520px"
                  priority={i < 2}
                />
                <div className="absolute inset-0 bg-gradient-to-t from-ink/70 via-transparent to-ink/10 opacity-80 transition group-hover:opacity-95" />
              </div>

              <span className="absolute left-4 top-4 text-[11px] font-semibold tracking-[0.3em] text-bone/70 sm:left-5 sm:top-5">
                {look.index}
              </span>

              <div className="absolute inset-x-0 bottom-0 p-5 sm:p-7">
                <p className="text-[10px] font-medium uppercase tracking-[0.28em] text-bone/50">
                  {look.kind}
                </p>
                <h2 className="display mt-2 text-[clamp(1.6rem,3.5vw,2.6rem)] text-bone">
                  {look.name}
                </h2>
                <p className="mt-3 max-w-[22ch] text-sm text-bone/55 opacity-0 translate-y-2 transition duration-500 group-hover:translate-y-0 group-hover:opacity-100">
                  {look.line}
                </p>
              </div>

              <span
                className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full border border-bone/30 text-[10px] font-semibold uppercase tracking-wider text-bone opacity-0 transition duration-400 group-hover:opacity-100 sm:right-5 sm:top-5"
                aria-hidden
              >
                Open
              </span>
            </motion.button>
          ))}

          <div className="flex h-[72svh] w-[min(70vw,380px)] shrink-0 flex-col justify-center pr-10 text-bone">
            <p className="display text-[clamp(2.5rem,6vw,4.5rem)] leading-[0.9]">
              More
              <br />
              loading
            </p>
            <p className="serif mt-6 max-w-[18ch] text-xl italic text-bone/55">
              Real stock meets this stage soon.
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
