import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Barlow, Barlow_Condensed, Cinzel, Inter, JetBrains_Mono } from "next/font/google";
import { Ambience } from "@/components/identity/Ambience";
import { Footer } from "@/components/shell/Footer";
import { Navbar } from "@/components/shell/Navbar";
import { Providers } from "@/components/shell/Providers";
import { Toaster } from "@/components/ui";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme/config";
import "./globals.css";

// One face per role, per theme. Loaded once; themes pick via --font-heading.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const barlow = Barlow({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-barlow", display: "swap" });
const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow-condensed",
  display: "swap",
});
const cinzel = Cinzel({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-cinzel", display: "swap" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://demo-sage.me"),
  title: { default: "DemoSage", template: "%s · DemoSage" },
  description: "CS2 demo analysis and coaching. Upload a demo, get every round debriefed against pro play.",
  keywords: ["CS2", "Counter-Strike 2", "demo analysis", "coaching", "ESEA", "stratbook"],
  openGraph: {
    title: "DemoSage",
    description: "Every round, debriefed. CS2 coaching from your own demos.",
    type: "website",
    url: "https://demo-sage.me",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          // Clerk modals render outside our token scope, so these are the CS2
          // palette as literals (see globals.css :root). .cl-* overrides handle themes.
          colorPrimary: "#f2a33a",
          colorBackground: "#141b24",
          colorForeground: "#e9eef4",
          colorMutedForeground: "#a7b4c3",
          colorInput: "#0f151c",
          colorInputForeground: "#e9eef4",
          borderRadius: "10px",
        },
      }}
    >
      <html
        lang="en"
        // The theme bootstrap script sets data-theme before hydration; React must not flag it.
        suppressHydrationWarning
        className={`${inter.variable} ${barlow.variable} ${barlowCondensed.variable} ${cinzel.variable} ${jetbrains.variable}`}
      >
        <body suppressHydrationWarning>
          {/* Saved theme before first paint: no palette flash for CS:GO or Khan users. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
          <Providers>
            <Ambience />
            <Navbar />
            <main className="container-app" style={{ paddingTop: "calc(var(--nav-h) + 24px)", minHeight: "calc(100dvh - var(--nav-h))" }}>
              {children}
            </main>
            <Footer />
            <Toaster />
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
