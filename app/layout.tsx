import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { Suspense } from "react";
import { ThemeProvider } from "next-themes";
import "./globals.css";

import { ScrollToTopOnNavigate } from "@/components/scroll-to-top-on-navigate";
import { SiteHeader } from "@/components/site-header";
import { getSiteUrl } from "@/lib/site-url";

export const metadata: Metadata = {
  metadataBase: new URL(getSiteUrl()),
  title: "Fishing the Good Fight",
  description:
    "Fishing the Good Fight participant portal — RSVP to chapter events and manage your information.",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <Suspense fallback={null}>
            <ScrollToTopOnNavigate />
          </Suspense>
          <SiteHeader />
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
