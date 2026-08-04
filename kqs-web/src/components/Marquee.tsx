"use client";

export function Marquee() {
  const phrase =
    "UNRELEASED  ·  LESOTHO  ·  THE STANDARD  ·  KQS FOOTWARE  ·  NOT A CATALOG  ·  ";
  const line = phrase.repeat(4);

  return (
    <div className="relative z-20 overflow-hidden border-y border-ink/10 bg-ink py-3 text-bone">
      <div className="marquee-track">
        <p className="display whitespace-nowrap px-4 text-[clamp(1.1rem,2.4vw,1.65rem)] tracking-[0.08em]">
          {line}
        </p>
        <p
          className="display whitespace-nowrap px-4 text-[clamp(1.1rem,2.4vw,1.65rem)] tracking-[0.08em]"
          aria-hidden
        >
          {line}
        </p>
      </div>
    </div>
  );
}
