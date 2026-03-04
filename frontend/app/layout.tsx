import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LifeOS Agent — AI Health Coach",
  description: "Unified AI health coaching: workouts, sleep, meals, and live research.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-950">{children}</body>
    </html>
  );
}
