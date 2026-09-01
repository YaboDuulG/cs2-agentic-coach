import type { Metadata } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Cinzel, Inter, JetBrains_Mono } from "next/font/google";
import { Navbar } from "@/components/Navbar";
import { Providers } from "@/components/Providers";
import { THEME_BOOTSTRAP_SCRIPT } from "@/lib/theme-config";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "600", "700", "900"], variable: "--font-cinzel" });
const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-jetbrains" });

export const metadata: Metadata = {
  title: "DemoSage — Analyze like a Khan. Dominate like Vitality.",
  description:
    "AI-powered CS2 demo analysis and coaching. Upload your match demo and receive tactical coaching powered by the Great Khan AI orchestrator.",
  keywords: ["CS2", "Counter-Strike", "demo analysis", "coaching", "AI", "tactics"],
  openGraph: {
    title: "DemoSage",
    description: "AI-powered CS2 coaching. Upload your demo. Dominate your enemies.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <ClerkProvider>
      <html lang="en" className={`dark ${cinzel.variable} ${inter.variable} ${jetbrains.variable}`}>
        <body suppressHydrationWarning className="antialiased">
          {/* Apply a saved non-default theme before first paint to avoid a palette flash. */}
          <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
          <Providers>
            <Navbar />
            {children}
          </Providers>
        </body>
      </html>
    </ClerkProvider>
  );
}
