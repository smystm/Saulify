import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { LanguageProvider } from "@/components/language-provider";
import { Onboarding } from "@/components/onboarding";
import "./globals.css";

// Self-hosted so builds do not depend on reaching fonts.googleapis.com.
const vazirmatn = localFont({
  src: "./fonts/Vazirmatn.woff2",
  variable: "--font-vazirmatn",
  weight: "100 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Saulify — evidence-first GitHub repository analysis",
  description:
    "Analyze a public GitHub repository for potential bugs and security issues. Get evidence, confidence levels, and copy-ready GitHub issue drafts without executing code.",
  applicationName: "Saulify",
  keywords: ["GitHub", "code review", "static analysis", "security", "AI", "open source"],
  openGraph: {
    title: "Saulify — find what the last commit missed",
    description: "Read-only, evidence-first analysis for public GitHub repositories.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#070908",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" dir="ltr" className={`${vazirmatn.variable} h-full`}>
      <body className="min-h-full bg-[#070908] font-sans text-zinc-100 antialiased">
        <LanguageProvider>
          {children}
          <Onboarding />
        </LanguageProvider>
      </body>
    </html>
  );
}
