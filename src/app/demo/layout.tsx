import type { Metadata } from "next";
import { DemoReady } from "./demo-ready";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <DemoReady />
    </>
  );
}
