import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "The Last Mile — AI on Public Rails (Prototype)",
    short_name: "Last Mile",
    description: "PROTOTYPE — Simulated DPI & Synthetic Data Only",
    start_url: "/",
    display: "standalone",
    dir: "rtl",
    lang: "ur",
    background_color: "#F5F6F3",
    theme_color: "#123C35",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml" }],
  };
}
