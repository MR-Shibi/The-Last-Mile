import type { Metadata, Viewport } from "next";
import { Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import SafetyBar from "@/components/SafetyBar";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });
const nastaliq = Noto_Nastaliq_Urdu({
  variable: "--font-urdu",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "The Last Mile — AI on Public Rails",
  description: "PROTOTYPE — Simulated DPI & Synthetic Data Only. Urdu-first relief access.",
  icons: { icon: [{ url: "/logo.png", type: "image/png", sizes: "192x192" }], apple: "/logo.png" },
};

export const viewport: Viewport = {
  themeColor: "#123C35",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ur" dir="rtl" suppressHydrationWarning className={`${inter.variable} ${nastaliq.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-page text-ink" suppressHydrationWarning>
        <LanguageProvider>
          <main className="flex-1">{children}</main>
          <SafetyBar />
        </LanguageProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
