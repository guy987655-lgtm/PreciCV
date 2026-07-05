import type { Metadata } from "next";
import { Bricolage_Grotesque, Figtree } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { DevUserSimulator } from "@/components/dev-user-simulator";
import "./globals.css";

const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

const figtree = Figtree({
  variable: "--font-figtree",
  subsets: ["latin"],
});

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
    <html lang="en" className={`${bricolage.variable} ${figtree.variable}`}>
      <body className="min-h-screen bg-bg font-sans text-ink antialiased">
        <AnalyticsProvider>{children}</AnalyticsProvider>
        <DevUserSimulator />
      </body>
    </html>
  );
}
