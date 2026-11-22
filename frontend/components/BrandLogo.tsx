"use client";

import { useState } from "react";

/** Inline crescent-and-pathway emblem, used if /logo.png cannot load (offline first visit, 2G, missing file). */
function FallbackEmblem() {
  return (
    <svg viewBox="0 0 48 48" className="h-full w-full" role="img" aria-label="The Last Mile Emblem">
      <path d="M24 3c10 0 18 7 18 16v10c0 7-9 14-18 16C15 43 6 36 6 29V19C6 10 14 3 24 3z" fill="#123C35" />
      <path d="M21 9a10 10 0 0 0 3 19 12 12 0 0 1-3-19z" fill="#fff" />
      <path d="m33 15 1 2.6h2.8l-2.2 1.7.8 2.7-2.4-1.6-2.4 1.6.8-2.7-2.2-1.7H32z" fill="#fff" />
      <path d="M10 37c6-8 15-12 28-13-9 3-15 8-18 17-4-1-7-2-10-4z" fill="#fff" />
    </svg>
  );
}

/** The emblem inside a white circular medallion with a warm-gold ring (reads crisply on the #123C35 header). */
export default function BrandLogo({ size = "h-12 w-12", padding = "p-1.5" }: { size?: string; padding?: string }) {
  const [broken, setBroken] = useState(false);
  return (
    <div className={`${size} ${padding} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-white shadow-sm ring-2 ring-gold`}>
      {broken ? (
        <FallbackEmblem />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- 9.6 KB static emblem; next/image adds nothing here
        <img src="/logo.png" alt="The Last Mile Emblem" width={48} height={48} decoding="async" onError={() => setBroken(true)} className="h-full w-full rounded-full object-contain" />
      )}
    </div>
  );
}
