import { createFileRoute } from "@tanstack/react-router";
import { History } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/audit")({
  head: () => ({
    meta: [
      { title: "Audit Trail — Brim Sentinel" },
      { name: "description", content: "Append-only record of every action, decision and blocked attempt." },
      { property: "og:title", content: "Audit Trail — Brim Sentinel" },
      { property: "og:description", content: "Append-only record of every action, decision and blocked attempt." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Oversight"
      title="Audit Trail"
      description="Append-only record of every action, decision and blocked attempt."
      phase="Phase 3–4"
      icon={History}
      planned={["Every event with actor, time and result","Evidence links for each decision","Denied authorization attempts","Filter by invoice or person","CSV export for auditors","Read-only for everyone"]}
    />
  ),
});
