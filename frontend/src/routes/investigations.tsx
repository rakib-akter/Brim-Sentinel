import { createFileRoute } from "@tanstack/react-router";
import { SearchCheck } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/investigations")({
  head: () => ({
    meta: [
      { title: "Investigations — Brim Sentinel" },
      { name: "description", content: "Suspicious invoices and open resolution cases, each with evidence and a Path to Pay." },
      { property: "og:title", content: "Investigations — Brim Sentinel" },
      { property: "og:description", content: "Suspicious invoices and open resolution cases, each with evidence and a Path to Pay." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Oversight"
      title="Investigations"
      description="Suspicious invoices and open resolution cases, each with evidence and a Path to Pay."
      phase="Phase 3"
      icon={SearchCheck}
      planned={["Cases with severity, owner and status","Evidence and linked records for every claim","Suggested Path to Pay, labelled as a recommendation","See Connections relationship graph","Financial Flight Recorder timeline","AI summaries that cite their evidence"]}
    />
  ),
});
