import { createFileRoute } from "@tanstack/react-router";
import { Wallet } from "lucide-react";
import { ComingSoon } from "@/components/sentinel/coming-soon";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Payments — Brim Sentinel" },
      { name: "description", content: "Scheduled, held, released, settled and failed payments — all simulated." },
      { property: "og:title", content: "Payments — Brim Sentinel" },
      { property: "og:description", content: "Scheduled, held, released, settled and failed payments — all simulated." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <ComingSoon
      eyebrow="Work"
      title="Payments"
      description="Scheduled, held, released, settled and failed payments — all simulated."
      phase="Phase 4"
      icon={Wallet}
      planned={["Scheduled and on-hold payments","Simulated release by an independent person","Simulated settlement and failures","Payment method and verification status","Approval history per payment","Link to the Flight Recorder"]}
    />
  ),
});
