import type { Metadata, Viewport } from "next";
import { Geist, Noto_Nastaliq_Urdu } from "next/font/google";
import "./globals.css";
import { LanguageProvider } from "@/lib/i18n";
import ServiceWorkerRegister from "@/components/ServiceWorkerRegister";
import PrototypeFooter from "@/components/PrototypeFooter";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const nastaliq = Noto_Nastaliq_Urdu({
  variable: "--font-urdu",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

export const metadata: Metadata = {
  title: "The Last Mile — AI on Public Rails",
  description: "PROTOTYPE — Simulated DPI & Synthetic Data Only. Urdu-first relief access.",
};

export const viewport: Viewport = {
  themeColor: "#0b3d2e",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ur" dir="rtl" suppressHydrationWarning className={`${geistSans.variable} ${nastaliq.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <LanguageProvider>
          <main className="flex-1 pb-32">{children}</main>
          <PrototypeFooter />
        </LanguageProvider>
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
