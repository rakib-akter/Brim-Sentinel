import { createFileRoute } from "@tanstack/react-router";
import { BarChart3 } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/analytics")({
  head: () => ({
    meta: [
      { title: "Analytics — Brim Sentinel" },
      { name: "description", content: "Invoice volume, processing status, risk categories and approval workload — sample data." },
      { property: "og:title", content: "Analytics — Brim Sentinel" },
      { property: "og:description", content: "Invoice volume, processing status, risk categories and approval workload — sample data." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Oversight"
      title="Analytics"
      description="Invoice volume, processing status, risk categories and approval workload — sample data."
      phase="Phase 4"
      icon={BarChart3}
      planned={["Invoice volume over time","Processing status breakdown","Risk category breakdown","Approval workload by person","Payment status distribution","Fictional sample data, clearly labelled"]}
    />
  ),
});
