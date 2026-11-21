import { createFileRoute } from "@tanstack/react-router";
import { CheckSquare } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/approvals")({
  head: () => ({
    meta: [
      { title: "Approvals — Brim Sentinel" },
      { name: "description", content: "Invoices waiting for authorization, with the full approval chain and history." },
      { property: "og:title", content: "Approvals — Brim Sentinel" },
      { property: "og:description", content: "Invoices waiting for authorization, with the full approval chain and history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Work"
      title="Approvals"
      description="Invoices waiting for authorization, with the full approval chain and history."
      phase="Phase 4"
      icon={CheckSquare}
      planned={["Pending approvals for your identity","Approval chain with current step","Delegation and escalation status","Approve or reject, enforced by the backend","Approval history panel","Clear disabled states when you cannot approve"]}
    />
  ),
});
