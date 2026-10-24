import type { Metadata } from "next";
import { ReportClient } from "@/components/report-client";

export const metadata: Metadata = {
  title: "Repository report — Saulify",
  description: "Evidence-based repository analysis report.",
};

export const instant = false;

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportClient id={id} />;
}
