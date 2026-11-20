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
    background_color: "#ffffff",
    theme_color: "#0b3d2e",
    icons: [{ src: "/favicon.ico", sizes: "any", type: "image/x-icon" }],
  };
}
