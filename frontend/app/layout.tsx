import type { Metadata } from "next";
import { Cinzel, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const cinzel = Cinzel({ subsets: ["latin"], weight: ["400", "600", "700", "900"], variable: "--font-cinzel" });
const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500", "600", "700"], variable: "--font-inter" });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "DemoSage — Analyze like a Khan. Dominate like an Empire.",
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
    <html lang="en" className={`dark ${cinzel.variable} ${inter.variable} ${jetbrains.variable}`}>
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
