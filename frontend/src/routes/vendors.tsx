import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/vendors")({
  head: () => ({
    meta: [
      { title: "Vendors — Brim Sentinel" },
      { name: "description", content: "Supplier directory with verification status, payment details and bank-change history." },
      { property: "og:title", content: "Vendors — Brim Sentinel" },
      { property: "og:description", content: "Supplier directory with verification status, payment details and bank-change history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Work"
      title="Vendors"
      description="Supplier directory with verification status, payment details and bank-change history."
      phase="Phase 4"
      icon={Building2}
      planned={["Supplier status, category and contacts","Masked payment details","Bank-change history and verification","Contracts and historical invoices","Linked investigations","Controlled workflow for sensitive changes"]}
    />
  ),
});
