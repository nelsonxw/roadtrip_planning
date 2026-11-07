import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoadTrip AI",
  description: "Plan driving routes, stops and daily itineraries with an assistant that proposes changes before applying them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans text-slate-900">{children}</body>
    </html>
  );
}
