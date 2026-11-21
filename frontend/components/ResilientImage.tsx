"use client";

import { useState } from "react";
import Icon, { type IconName } from "@/components/Icon";

/** Image that never breaks the layout: fixed aspect box; on 2G/offline/decode failure it shows a crisp vector
 * icon on the soft-green tint instead (no layout shift, no broken-image glyph). */
export default function ResilientImage({ src, alt, fallbackIcon = "camera", aspect = "aspect-[16/10]", className = "" }: {
  src: string | null | undefined; alt: string; fallbackIcon?: IconName; aspect?: string; className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const broken = !src || failed === src;
  return (
    <div className={`relative w-full overflow-hidden rounded-xl border-2 border-line bg-tint ${aspect} ${className}`}>
      {broken ? (
        <div className="absolute inset-0 flex items-center justify-center text-brand" role="img" aria-label={alt}>
          <Icon name={fallbackIcon} size={48} strokeWidth={1.75} />
        </div>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- local object URLs / tiny assets; next/image adds nothing here
        <img src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(src)} className="absolute inset-0 h-full w-full object-contain" />
      )}
    </div>
  );
}
