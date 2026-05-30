import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: "NW Portfolio | Wealth Enterprise Platform",
  description: "Your complete net worth & wealth management platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
      suppressHydrationWarning        // ← fixes browser-extension attr injection (QuickBooks, Grammarly, etc.)
    >
      <body
        className="min-h-full flex flex-col"
        suppressHydrationWarning      // ← extensions often modify <body> too
      >
        {children}
      </body>
    </html>
  );
}