"use client";

import AppHeader from "@/components/AppHeader";
import Icon, { type IconName } from "@/components/Icon";
import type { Tone } from "@/lib/status";

/** LTR island for English text, numbers and parentheses inside RTL Urdu containers (never flips). */
export function Ltr({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span dir="ltr" className={`inline-block ${className}`}>{children}</span>;
}

const TONE_ICON: Record<Tone, IconName> = { safe: "checkCircle", review: "alert", danger: "x", neutral: "info" };

export function StatusPill({ tone, children, icon = true, className = "" }: { tone: Tone; children: React.ReactNode; icon?: boolean; className?: string }) {
  return (
    <span className={`pill pill-${tone} ${className}`}>
      {icon && <Icon name={TONE_ICON[tone]} size={16} strokeWidth={2.5} />}
      {children}
    </span>
  );
}

/** Standard page frame: shared header + centred content column. */
export function PageShell({ title, width = "narrow", children }: { title?: string; width?: "narrow" | "wide" | "full"; children: React.ReactNode }) {
  const w = width === "narrow" ? "max-w-2xl" : width === "wide" ? "max-w-5xl" : "max-w-6xl";
  return (
    <>
      <AppHeader title={title} />
      <div className={`mx-auto w-full ${w} px-4 py-5`}>{children}</div>
    </>
  );
}

/** Icon tile used on cards and section headers. */
export function IconTile({ name, size = 28, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded-2xl bg-tint text-brand ${className}`} aria-hidden>
      <Icon name={name} size={size} />
    </span>
  );
}
