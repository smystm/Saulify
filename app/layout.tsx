import type { Metadata, Viewport } from "next";
import { Vazirmatn } from "next/font/google";
import { LanguageProvider } from "@/components/language-provider";
import "./globals.css";

const vazirmatn = Vazirmatn({
  subsets: ["arabic", "latin"],
  variable: "--font-vazirmatn",
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
        <LanguageProvider>{children}</LanguageProvider>
      </body>
    </html>
  );
}
