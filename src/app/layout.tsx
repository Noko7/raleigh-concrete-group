import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Bebas_Neue, Sora } from "next/font/google";

import { JsonLd } from "@/components/json-ld";
import { QuoteModalRoot } from "@/components/quote-modal";
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
    "Raleigh Concrete Group builds concrete driveways, patios, walkways, retaining walls and pavers across Raleigh, Cary, Apex, Wake Forest and Durham, NC. On time, clear pricing, and free quotes, usually the same day.",
  metadataBase: new URL("https://www.raleighconcrete.net"),
  alternates: { canonical: "/" },
  openGraph: {
    title: "Raleigh Concrete Group",
    description:
      "Driveways, patios, retaining walls and pavers across the Triangle, built to last. Get a free quote, usually the same day.",
    url: "https://www.raleighconcrete.net",
    siteName: "Raleigh Concrete Group",
    type: "website",
    images: [
      {
        url: "/images/imessage-preview.jpg",
        width: 1200,
        height: 1200,
        type: "image/jpeg",
        alt: "Raleigh Concrete Group: concrete driveways, patios and pavers in the Triangle",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Raleigh Concrete Group",
    description:
      "Driveways, patios, retaining walls and pavers across the Triangle, built to last.",
    images: ["/images/imessage-preview.jpg"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${headline.variable} ${body.variable} h-full antialiased`}>
      <body className="min-h-full">
        <JsonLd data={[localBusinessSchema(), websiteSchema()]} />
        {children}
        <QuoteModalRoot />
        <Analytics />
      </body>
    </html>
  );
}
