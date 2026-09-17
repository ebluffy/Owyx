import type { Metadata } from "next";
import { JetBrains_Mono, Onest, Sora, Unbounded } from "next/font/google";
import { AuthProvider } from "@/hooks/useAuth";
import { LocaleProvider } from "@/hooks/useLocale";
import SkipLink from "@/components/layout/SkipLink";
import SpaceParticles from "@/components/brand/SpaceParticles";
import "./globals.css";

/* High-craft typography stack with native Cyrillic + Latin support.
 * Display/Headings = Unbounded (techno/gaming geometric) + Sora for latin wordmark.
 * Body/UI = Onest (modern screen-engineered grotesk with full cyrillic support).
 * Mono = JetBrains Mono (technical monospace for IPs, versions, and logs).
 */
const onest = Onest({
  variable: "--font-onest",
  subsets: ["cyrillic", "latin", "latin-ext"],
  display: "swap",
});

const unbounded = Unbounded({
  variable: "--font-unbounded",
  subsets: ["cyrillic", "latin", "latin-ext"],
  display: "swap",
});

const sora = Sora({
  variable: "--font-sora",
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["cyrillic", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Owyx™",
  description: "Owyx™ — Minecraft launcher and site account. Download, sign in, play.",
  keywords: ["owyx", "minecraft", "launcher", "owyx.site"],
  authors: [{ name: "ebluffy" }],
  icons: {
    icon: "/favicon-owyx.svg",
  },
  openGraph: {
    title: "Owyx™",
    description: "Owyx™ launcher and site account.",
    type: "website",
    locale: "ru_RU",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${onest.variable} ${unbounded.variable} ${sora.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-screen overflow-x-clip flex flex-col">
        <div className="owyx-space" aria-hidden="true" />
        <div className="owyx-vignette" aria-hidden="true" />
        <SpaceParticles />
        <LocaleProvider>
          <SkipLink />
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
