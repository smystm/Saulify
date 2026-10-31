import type { Metadata } from "next";
import { FeaturesView } from "@/components/features-view";

export const metadata: Metadata = {
  title: "Features — Saulify",
  description:
    "Security analysis, code quality, architecture review, and evidence-backed AI insights for public GitHub repositories.",
};

export default function FeaturesPage() {
  return <FeaturesView />;
}
