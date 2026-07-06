import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import {
  Bricolage_Grotesque,
  Figtree,
  Source_Serif_4,
  Playfair_Display,
  Lora,
  Space_Grotesk,
  Archivo,
  JetBrains_Mono,
  Inter,
} from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { DevUserSimulator } from "@/components/dev-user-simulator";
import { ScrollToTop } from "@/components/scroll-to-top";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

/* Extra families that power the expanded CV template gallery (cv-renderer). */
const sourceSerif = Source_Serif_4({
  variable: "--font-source-serif",
  subsets: ["latin"],
});
const playfair = Playfair_Display({
  variable: "--font-playfair",
  subsets: ["latin"],
});
const lora = Lora({ variable: "--font-lora", subsets: ["latin"] });
const spaceGrotesk = Space_Grotesk({
  variable: "--font-space",
  subsets: ["latin"],
});
const archivo = Archivo({ variable: "--font-archivo", subsets: ["latin"] });
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono-cv",
  subsets: ["latin"],
});
const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

const cvFontVars = [
  sourceSerif.variable,
  playfair.variable,
  lora.variable,
  spaceGrotesk.variable,
  archivo.variable,
  jetbrainsMono.variable,
  inter.variable,
].join(" ");

export const metadata: Metadata = {
  title: "SpeCV — AI-Powered Career Agent & CV Tailoring",
  description:
    "Generate precise, custom-tailored, one-page resumes and gap-analysis reports for every job application.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${bricolage.variable} ${figtree.variable} ${cvFontVars}`}
    >
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <AnalyticsProvider>{children}</AnalyticsProvider>
        <ScrollToTop />
        <DevUserSimulator />
        <Analytics />
      </body>
    </html>
  );
}
