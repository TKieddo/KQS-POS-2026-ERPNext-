import type { Metadata } from "next";
import { Instrument_Serif, Manrope, Unbounded } from "next/font/google";
import "./globals.css";

const ui = Manrope({
  variable: "--font-ui",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const display = Unbounded({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800", "900"],
});

const serif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "KQS FOOTWARE — The standard. Lesotho.",
  description:
    "Kabeli Quality Shoes. Premium apparel and footwear from Lesotho. Unreleased. Not a catalog — a statement.",
  openGraph: {
    title: "KQS FOOTWARE",
    description: "Premium apparel & footwear. Lesotho. Something sharper is loading.",
    siteName: "KQS FOOTWARE",
    type: "website",
  },
  icons: {
    icon: "/kqs-logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${ui.variable} ${display.variable} ${serif.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-bone text-ink">{children}</body>
    </html>
  );
}
