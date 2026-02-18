import type { Metadata } from "next";
import { Space_Grotesk, Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const spaceGrotesk = Space_Grotesk({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

export const metadata: Metadata = {
  title: "Arche",
  description: "Enterprise AI that learns and specializes for your company",
  icons: {
    icon: [
      {
        url: "/favicon-96x96.png?v=2",
        sizes: "96x96",
        type: "image/png",
      },
      {
        url: "/favicon.svg?v=2",
        type: "image/svg+xml",
      },
    ],
    shortcut: "/favicon.ico?v=2",
    apple: [
      {
        url: "/apple-touch-icon.png?v=2",
        sizes: "180x180",
      },
    ],
  },
  appleWebApp: {
    title: "Arche",
  },
  manifest: "/site.webmanifest?v=2",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${instrumentSerif.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
