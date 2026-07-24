import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Geist, Geist_Mono, Space_Grotesk, Tinos } from "next/font/google";
import { Toaster } from "sonner";
import "katex/dist/katex.min.css";
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
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const tinos = Tinos({
  variable: "--font-tinos",
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  title: "Arche",
  description: "Enterprise AI that learns and specializes for your company",
  icons: {
    icon: [
      {
        url: "/favicon-32x32.png?v=3",
        sizes: "32x32",
        type: "image/png",
      },
      {
        url: "/favicon-16x16.png?v=3",
        sizes: "16x16",
        type: "image/png",
      },
    ],
    shortcut: "/favicon.ico?v=3",
    apple: [
      {
        url: "/apple-touch-icon.png?v=3",
        sizes: "180x180",
      },
    ],
  },
  appleWebApp: {
    title: "Arche",
  },
  manifest: "/site.webmanifest?v=3",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await headers();

  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${tinos.variable} antialiased`}
      >
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
