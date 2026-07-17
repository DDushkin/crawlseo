import type { Metadata } from "next";
import { Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

/**
 * Atomize uses SF Pro Text as primary.
 * On the web we map to Inter (closest open metric match) + system SF stack fallback.
 */
const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const interHeading = Inter({
  variable: "--font-heading",
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CrawlSEO",
    template: "%s · CrawlSEO",
  },
  description:
    "Self-hosted SEO monitoring — GSC, crawl health, Core Web Vitals",
  icons: {
    icon: [
      {
        url: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='18' fill='%230284FE'/><path d='M22 68 L50 22 L78 68 Z' fill='none' stroke='white' stroke-width='8' stroke-linejoin='round'/><circle cx='50' cy='58' r='6' fill='white'/></svg>",
        type: "image/svg+xml",
      },
    ],
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
      className={`${inter.variable} ${interHeading.variable} ${plexMono.variable} h-full`}
    >
      <body
        className="h-full font-sans"
        style={{
          fontFamily:
            'var(--font-sans), "SF Pro Text", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
