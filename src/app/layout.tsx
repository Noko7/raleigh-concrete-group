import type { Metadata } from "next";
import { Bebas_Neue, Sora } from "next/font/google";

import "./globals.css";

const headline = Bebas_Neue({
  variable: "--font-headline",
  weight: "400",
  subsets: ["latin"],
});

const body = Sora({
  variable: "--font-body",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: {
    default: "Raleigh Concrete Group | Concrete Driveways, Patios & Pavers",
    template: "%s | Raleigh Concrete Group",
  },
  description:
    "Raleigh Concrete Group builds concrete driveways, patios, walkways, retaining walls and pavers across Raleigh, Cary, Apex, Wake Forest and Durham, NC. Licensed, insured, 4.9★ — free same-day quotes.",
  metadataBase: new URL("https://www.raleighconcrete.net"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Raleigh Concrete Group",
    description:
      "Concrete driveways, patios, retaining walls and pavers across the Triangle — built to last. Free same-day quote.",
    url: "https://www.raleighconcrete.net",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Raleigh Concrete Group",
    description:
      "Concrete driveways, patios, retaining walls and pavers across the Triangle — built to last.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${headline.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
