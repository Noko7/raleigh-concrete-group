import type { Metadata } from "next";
import { Bebas_Neue, Sora } from "next/font/google";

import { Clarity } from "@/components/clarity";
import { JsonLd } from "@/components/json-ld";
import { QuoteModalRoot } from "@/components/quote-modal";
import { VercelInsights } from "@/components/vercel-insights";
import { localBusinessSchema, websiteSchema } from "@/lib/seo";
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
    "Raleigh Concrete Group builds concrete driveways, patios, walkways, retaining walls and pavers across Raleigh, Cary, Apex, Wake Forest and Durham, NC. On time, clear pricing, and free written quotes.",
  metadataBase: new URL("https://www.raleighconcrete.net"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Raleigh Concrete Group",
    description:
      "Driveways, patios, retaining walls and pavers across the Triangle, built to last. Get a free written quote.",
    url: "https://www.raleighconcrete.net",
    siteName: "Raleigh Concrete Group",
    type: "website",
    // Solid white, not transparent: iMessage and WhatsApp render a transparent logo as a black square in dark mode.
    images: [
      {
        url: "/images/imessage-preview-image.png",
        width: 2000,
        height: 2000,
        type: "image/png",
        alt: "Raleigh Concrete Group",
      },
    ],
  },
  twitter: {
    // The artwork is square; summary_large_image would crop it.
    card: "summary",
    title: "Raleigh Concrete Group",
    description:
      "Driveways, patios, retaining walls and pavers across the Triangle, built to last.",
    images: ["/images/imessage-preview-image.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${headline.variable} ${body.variable} antialiased`}>
      <body className="min-h-screen">
        <JsonLd data={[localBusinessSchema(), websiteSchema()]} />
        {/*
          Overflow guard here, not on html/body: on iPhone Safari a root overflow rule makes position: fixed
          elements (the bottom bar) slide while scrolling.
        */}
        <div className="site-clip">{children}</div>
        <QuoteModalRoot />
        <VercelInsights />
        <Clarity />
      </body>
    </html>
  );
}
