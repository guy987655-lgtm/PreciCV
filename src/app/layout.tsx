import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { AnalyticsProvider } from "@/components/analytics-provider";
import { DevUserSimulator } from "@/components/dev-user-simulator";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PreciCV — AI-Powered Career Agent & CV Tailoring",
  description:
    "Generate precise, custom-tailored, one-page resumes and gap-analysis reports for every job application.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body className="min-h-screen bg-slate-50 antialiased">
        <AnalyticsProvider>{children}</AnalyticsProvider>
        <DevUserSimulator />
      </body>
    </html>
  );
}
