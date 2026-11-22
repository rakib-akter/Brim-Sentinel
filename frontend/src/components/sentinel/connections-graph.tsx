import { memo, useEffect, useMemo, useState } from "react";
import {
  Background,
  Controls,
  Handle,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Building2,
  CreditCard,
  FileSignature,
  FileText,
  Landmark,
  List,
  type LucideIcon,
  Route as RouteIcon,
  Share2,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvoiceDetail as InvoiceRecord } from "@/lib/api/schema";
import {
  buildRelationshipGraph,
  layoutRelationshipGraph,
  REL_LABEL,
  type EntityKind,
  type RelKind,
  type RelNode,
} from "@/lib/graph/relationship-graph";
import { EvidenceDrawer } from "./evidence-drawer";

const ICON: Record<EntityKind, LucideIcon> = {
  invoice: FileText,
  vendor: Building2,
  route: RouteIcon,
  bank_change: Landmark,
  matched_invoice: FileText,
  card_transaction: CreditCard,
  contract: FileSignature,
  payment: Wallet,
};

const TONE: Record<RelNode["tone"], string> = {
  neutral: "border-border bg-card",
  risk: "border-critical/60 bg-critical-soft",
  warn: "border-warning/60 bg-warning-soft",
  ok: "border-success/50 bg-success-soft",
};

type EntityData = { model: RelNode; center: boolean; onOpen: (id: string) => void };
type EntityNode = Node<EntityData, "entity">;

const Entity = memo(function Entity({ data }: NodeProps<EntityNode>) {
  const { model, center, onOpen } = data;
  const Icon = ICON[model.kind];
  const h = "!size-1 !border-0 !bg-transparent !left-1/2 !top-1/2";
  return (
    <div className="graph-node-enter">
      <Handle type="target" position={Position.Top} className={h} />
      <button
        type="button"
        onClick={() => onOpen(model.id)}
        aria-label={`${model.label}: ${model.detail}. Open record.`}
        className={`nodrag flex w-[190px] items-center gap-2 rounded-xl border px-3 py-2 text-left shadow-card transition-shadow hover:shadow-raised ${TONE[model.tone]} ${
          center ? "ring-2 ring-primary/40" : ""
        }`}
      >
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-primary-soft text-primary">
          <Icon className="size-3.5" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12px] font-semibold">{model.label}</span>
          <span className="block truncate text-[10.5px] text-muted-foreground">{model.detail}</span>
        </span>
      </button>
      <Handle type="source" position={Position.Bottom} className={h} />
    </div>
  );
});
const nodeTypes = { entity: Entity };

/** Case-scoped map of what Sentinel connected around this invoice. */
export function ConnectionsGraph({ record }: { record: InvoiceRecord }) {
  const graph = useMemo(() => buildRelationshipGraph(record), [record]);
  const kinds = useMemo(
    () => [...new Set(graph.edges.map((e) => e.kind))] as RelKind[],
    [graph.edges],
  );
  const [off, setOff] = useState<Set<RelKind>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [listView, setListView] = useState(false);
  useEffect(() => {
    setMounted(true);
    if (window.matchMedia("(max-width: 767px)").matches) setListView(true);
  }, []);

  const visibleEdges = graph.edges.filter((e) => !off.has(e.kind));
  const visibleIds = new Set([graph.center, ...visibleEdges.flatMap((e) => [e.source, e.target])]);
  const visibleNodes = graph.nodes.filter((n) => visibleIds.has(n.id));
  const pos = layoutRelationshipGraph(visibleNodes, graph.center);

  const nodes: EntityNode[] = visibleNodes.map((n) => ({
    id: n.id,
    type: "entity",
    position: pos.get(n.id) ?? { x: 0, y: 0 },
    data: { model: n, center: n.id === graph.center, onOpen: setOpenId },
    draggable: true,
  }));
  const edges: Edge[] = visibleEdges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "straight",
    label: e.label,
    labelStyle: { fontSize: 10, fill: "var(--color-muted-foreground)" },
    labelBgStyle: { fill: "var(--color-card)" },
    style: {
      stroke: e.certainty === "confirmed" ? "var(--color-foreground)" : "var(--color-warning)",
      strokeOpacity: e.certainty === "confirmed" ? 0.45 : 0.9,
      strokeWidth: 1.5,
      strokeDasharray: e.certainty === "possible" ? "5 4" : undefined,
    },
    focusable: false,
  }));
  const open = graph.nodes.find((n) => n.id === openId) ?? null;
  const onlyInvoice = graph.nodes.length <= 2;

  return (
    <section className="surface overflow-hidden" aria-labelledby="connections-heading">
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2
            id="connections-heading"
            className="flex items-center gap-2 text-[15px] font-semibold"
          >
            <Share2 className="size-4 text-primary" aria-hidden /> Connections
          </h2>
          <p className="text-xs text-muted-foreground">
            Records Sentinel linked to this invoice: supplier, payment route, bank changes,
            contracts, duplicates and payments. Only records your role can see.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setListView((v) => !v)}
          aria-pressed={listView}
        >
          {listView ? <Share2 aria-hidden /> : <List aria-hidden />}
          {listView ? "Graph view" : "List view"}
        </Button>
      </header>
      {kinds.length > 1 && (
        <div
          className="flex flex-wrap items-center gap-2 border-b px-5 py-2.5"
          role="group"
          aria-label="Filter relationship types"
        >
          <span className="text-xs text-muted-foreground">Show:</span>
          {kinds.map((k) => {
            const on = !off.has(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                onClick={() =>
                  setOff((s) => {
                    const n = new Set(s);
                    if (on) n.add(k);
                    else n.delete(k);
                    return n;
                  })
                }
                className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
                  on ? "border-primary/40 bg-primary-soft text-primary" : "text-muted-foreground"
                }`}
              >
                {REL_LABEL[k]}
              </button>
            );
          })}
        </div>
      )}
      {onlyInvoice ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">
          No cross-record connections were found for this invoice.
        </p>
      ) : !mounted ? (
        <Skeleton className="m-5 h-[380px] rounded-xl" />
      ) : listView ? (
        <ul className="divide-y">
          {visibleEdges.map((e) => {
            const other = graph.nodes.find(
              (n) => n.id === (e.source === graph.center ? e.target : e.source),
            );
            if (!other) return null;
            return (
              <li key={e.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(other.id)}
                  className="w-full px-5 py-3 text-left text-sm hover:bg-secondary/60"
                >
                  <span className="font-medium">{other.label}</span>{" "}
                  <span className="text-muted-foreground">
                    · {e.label} · {e.certainty === "confirmed" ? "confirmed" : "possible match"}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="h-[420px] w-full bg-muted/30">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
            minZoom={0.35}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="var(--color-border-strong)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-5 py-2.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="26"
              y2="3"
              stroke="var(--color-foreground)"
              strokeOpacity="0.45"
              strokeWidth="1.5"
            />
          </svg>
          Confirmed relationship
        </span>
        <span className="flex items-center gap-1.5">
          <svg width="26" height="6" aria-hidden>
            <line
              x1="0"
              y1="3"
              x2="26"
              y2="3"
              stroke="var(--color-warning)"
              strokeWidth="1.5"
              strokeDasharray="5 4"
            />
          </svg>
          Possible match (needs a person)
        </span>
        {graph.hidden > 0 && <span>{graph.hidden} more not shown</span>}
      </div>
      <EvidenceDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenId(null)}
        eyebrow={open ? open.kind.replaceAll("_", " ") : ""}
        title={open?.label ?? ""}
        description={open?.detail}
        facts={open?.facts ?? []}
        link={open?.link}
      />
    </section>
  );
}
