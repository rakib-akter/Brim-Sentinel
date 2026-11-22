import { memo, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Ban,
  Brain,
  CircleDashed,
  FileText,
  Inbox,
  Landmark,
  List,
  type LucideIcon,
  Network,
  PauseCircle,
  ScrollText,
  ShieldCheck,
  Sparkles,
  UserCheck,
  Wallet,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { InvoiceDetail as InvoiceRecord } from "@/lib/api/schema";
import { flightQuery } from "@/lib/api/queries";
import { formatDate } from "@/lib/format";
import {
  buildDecisionGraph,
  layoutDecisionGraph,
  type GraphNodeModel,
  type NodeStatus,
  type StageKey,
} from "@/lib/graph/decision-graph";
import { isNotableResult, plain, policyLabel } from "@/lib/plain-language";
import { useSession } from "@/lib/session";
import { EvidenceDrawer } from "./evidence-drawer";
import { Evidence } from "./flight-recorder";
import { errorMessage } from "./workflow-form";

const STAGE_ICON: Record<StageKey, LucideIcon> = {
  intake: Inbox,
  extraction: FileText,
  coding: Brain,
  validation: ShieldCheck,
  hold: PauseCircle,
  investigation: Sparkles,
  verification: Landmark,
  approval: UserCheck,
  payment: Wallet,
  audit: ScrollText,
};

const STATUS_STYLE: Record<NodeStatus, { card: string; chip: string; label: string }> = {
  completed: {
    card: "border-border bg-card",
    chip: "bg-success-soft text-success-foreground",
    label: "Done",
  },
  blocked: {
    card: "border-critical/60 bg-critical-soft/60 ring-2 ring-critical/20",
    chip: "bg-critical-soft text-critical-foreground",
    label: "Blocked",
  },
  pending: {
    card: "border-warning/60 bg-card",
    chip: "bg-warning-soft text-warning-foreground",
    label: "Waiting",
  },
  proposed: {
    card: "border-dashed border-border-strong bg-card/70",
    chip: "bg-secondary text-muted-foreground",
    label: "Not yet",
  },
  failed: {
    card: "border-critical/60 bg-card",
    chip: "bg-critical-soft text-critical-foreground",
    label: "Stopped",
  },
};

type StageNodeData = { model: GraphNodeModel; onOpen: (id: string) => void; focused: boolean };
type StageFlowNode = Node<StageNodeData, "stage">;

const StageNode = memo(function StageNode({ data }: NodeProps<StageFlowNode>) {
  const { model, onOpen, focused } = data;
  const Icon = STAGE_ICON[model.stage];
  const style = STATUS_STYLE[model.status];
  const handle = "!size-1.5 !border-0 !bg-transparent";
  return (
    <div className="graph-node-enter">
      <Handle type="target" position={Position.Left} id="l" className={handle} />
      <Handle type="target" position={Position.Top} id="t" className={handle} />
      <button
        type="button"
        onClick={() => onOpen(model.id)}
        title={model.rationale ?? model.summary}
        aria-label={`${model.label}: ${style.label}. ${model.summary}. Open details.`}
        className={`nodrag w-[200px] rounded-xl border px-3 py-2.5 text-left shadow-card transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-raised focus-visible:outline-2 focus-visible:outline-ring ${style.card} ${
          focused ? "outline-2 outline-primary outline-offset-2" : ""
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`grid size-7 shrink-0 place-items-center rounded-lg ${
              model.status === "blocked" ? "bg-critical text-white" : "bg-primary-soft text-primary"
            } ${model.isHoldReason ? "node-pulse" : ""}`}
          >
            <Icon className="size-3.5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px] font-semibold leading-tight">
              {model.label}
            </span>
            <span
              className={`mt-0.5 inline-block rounded-full px-1.5 py-px text-[10px] font-medium ${style.chip}`}
            >
              {style.label}
            </span>
          </span>
        </span>
        <span className="mt-1.5 line-clamp-2 block text-[11px] leading-snug text-muted-foreground">
          {model.summary}
        </span>
        {(model.actor || model.at) && (
          <span className="mt-1 block truncate text-[10px] text-muted-foreground/90">
            {model.actor}
            {model.actor && model.at ? " · " : ""}
            {model.at
              ? formatDate(model.at, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })
              : ""}
          </span>
        )}
      </button>
      <Handle type="source" position={Position.Right} id="r" className={handle} />
      <Handle type="source" position={Position.Bottom} id="b" className={handle} />
    </div>
  );
});

const nodeTypes = { stage: StageNode };

/** Interactive explanation of how this invoice got to its current state, and what comes next. */
export function DecisionGraph({ record }: { record: InvoiceRecord }) {
  const { user } = useSession();
  const flight = useQuery(flightQuery(user.id, record.id));
  const [mounted, setMounted] = useState(false);
  const [listView, setListView] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    setMounted(true);
    if (window.matchMedia("(max-width: 767px)").matches) setListView(true);
  }, []);

  const model = useMemo(() => buildDecisionGraph(record, flight.data), [record, flight.data]);
  const { nodes, edges } = useMemo(() => {
    const pos = layoutDecisionGraph(model);
    const rowOf = (id: string) => pos.get(id)?.y ?? 0;
    const nodes: StageFlowNode[] = model.nodes.map((m) => ({
      id: m.id,
      type: "stage",
      position: pos.get(m.id) ?? { x: 0, y: 0 },
      data: { model: m, onOpen: setOpenId, focused: m.id === model.focusId },
      draggable: false,
    }));
    const edges: Edge[] = model.edges.map((e) => {
      const crossRow = rowOf(e.source) !== rowOf(e.target);
      const proposed = e.kind === "proposed";
      const color = proposed
        ? "var(--color-muted-foreground)"
        : e.active
          ? "var(--color-primary)"
          : "var(--color-border-strong)";
      return {
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: crossRow ? "b" : "r",
        targetHandle: crossRow ? "t" : "l",
        type: "smoothstep",
        style: {
          stroke: color,
          strokeWidth: e.active ? 2.25 : 1.5,
          strokeDasharray: proposed ? "6 5" : undefined,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
        focusable: false,
      };
    });
    return { nodes, edges };
  }, [model]);

  const open = model.nodes.find((n) => n.id === openId) ?? null;

  return (
    <section className="surface overflow-hidden" aria-labelledby="graph-heading">
      <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
        <div className="min-w-0 flex-1">
          <h2 id="graph-heading" className="flex items-center gap-2 text-[15px] font-semibold">
            <Network className="size-4 text-primary" aria-hidden /> Decision graph
          </h2>
          <p className="text-xs text-muted-foreground">
            How this invoice reached its current state, built from recorded audit events and the
            current record. Click any step for its evidence.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setListView((v) => !v)}
          aria-pressed={listView}
        >
          {listView ? <Network aria-hidden /> : <List aria-hidden />}
          {listView ? "Graph view" : "List view"}
        </Button>
      </header>

      {model.nodes.some((n) => n.isHoldReason) && (
        <HoldExplainer node={model.nodes.find((n) => n.isHoldReason)!} onOpen={setOpenId} />
      )}

      {flight.error ? (
        <p role="alert" className="px-5 py-4 text-sm">
          {errorMessage(flight.error)} The graph below uses the invoice record only.
        </p>
      ) : null}

      {!mounted || flight.isPending ? (
        <Skeleton className="m-5 h-[360px] rounded-xl" />
      ) : listView ? (
        <GraphList nodes={model.nodes} onOpen={setOpenId} />
      ) : (
        <div className="h-[440px] w-full bg-muted/30" aria-label="Decision graph canvas">
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            fitView
            fitViewOptions={{ padding: 0.08, maxZoom: 1.1 }}
            minZoom={0.35}
            maxZoom={1.6}
            nodesDraggable={false}
            nodesConnectable={false}
            elementsSelectable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background gap={18} size={1} color="var(--color-border-strong)" />
            <Controls showInteractive={false} position="bottom-right" />
          </ReactFlow>
        </div>
      )}
      <Legend />

      <EvidenceDrawer
        open={!!open}
        onOpenChange={(v) => !v && setOpenId(null)}
        eyebrow={open ? `${STATUS_STYLE[open.status].label} · ${basisLabel(open)}` : ""}
        title={open?.label ?? ""}
        description={open?.summary}
        facts={
          open
            ? [
                ["Who", open.actor],
                [
                  "When",
                  open.at ? formatDate(open.at, { dateStyle: "medium", timeStyle: "short" }) : null,
                ],
              ]
            : []
        }
      >
        {open && <NodeDetail node={open} record={record} />}
      </EvidenceDrawer>
    </section>
  );
}

function basisLabel(n: GraphNodeModel) {
  if (n.basis === "proposed") return "proposed, not yet happened";
  if (n.basis === "record") return "from the current record";
  return `${n.events.length} recorded event${n.events.length === 1 ? "" : "s"}`;
}

function HoldExplainer({ node, onOpen }: { node: GraphNodeModel; onOpen: (id: string) => void }) {
  return (
    <div className="flex flex-wrap items-start gap-3 border-b bg-critical-soft/50 px-5 py-3">
      <Ban className="mt-0.5 size-4 shrink-0 text-critical" aria-hidden />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">Why this invoice is held: {node.summary}</p>
        {node.rationale && <p className="text-xs text-muted-foreground">{node.rationale}</p>}
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(node.id)}>
        Inspect the hold
      </Button>
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 border-t px-5 py-2.5 text-[11px] text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <svg width="26" height="6" aria-hidden>
          <line x1="0" y1="3" x2="26" y2="3" stroke="var(--color-primary)" strokeWidth="2.25" />
        </svg>
        Recorded path to current state
      </span>
      <span className="flex items-center gap-1.5">
        <svg width="26" height="6" aria-hidden>
          <line
            x1="0"
            y1="3"
            x2="26"
            y2="3"
            stroke="var(--color-muted-foreground)"
            strokeWidth="1.5"
            strokeDasharray="6 5"
          />
        </svg>
        Proposed next step (not yet happened)
      </span>
      <span className="flex items-center gap-1.5">
        <CircleDashed className="size-3" aria-hidden /> Dashed card = proposed
      </span>
      <span className="ml-auto">Settlement is always simulated.</span>
    </div>
  );
}

function GraphList({ nodes, onOpen }: { nodes: GraphNodeModel[]; onOpen: (id: string) => void }) {
  return (
    <ol className="stagger divide-y" aria-label="Decision steps in order">
      {nodes.map((n) => {
        const Icon = STAGE_ICON[n.stage];
        const style = STATUS_STYLE[n.status];
        return (
          <li key={n.id}>
            <button
              type="button"
              onClick={() => onOpen(n.id)}
              className={`flex w-full items-start gap-3 px-5 py-3 text-left hover:bg-secondary/60 ${
                n.basis === "proposed" ? "opacity-80" : ""
              }`}
            >
              <span
                className={`grid size-7 shrink-0 place-items-center rounded-lg ${n.status === "blocked" ? "bg-critical text-white" : "bg-primary-soft text-primary"}`}
              >
                <Icon className="size-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {n.label}
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-medium ${style.chip}`}
                  >
                    {style.label}
                  </span>
                  {n.basis === "proposed" && (
                    <span className="text-[10px] font-normal text-muted-foreground">proposed</span>
                  )}
                </span>
                <span className="block text-xs text-muted-foreground">{n.summary}</span>
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

function NodeDetail({ node, record }: { node: GraphNodeModel; record: InvoiceRecord }) {
  const [all, setAll] = useState(false);
  const events = all ? node.events : node.events.slice(-4);
  const showActions =
    node.stage === "hold" || node.stage === "approval" || node.basis === "proposed";
  return (
    <div className="space-y-5 text-sm">
      {node.rationale && <p className="leading-relaxed">{node.rationale}</p>}
      {node.basis === "proposed" && (
        <p className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
          This step comes from Sentinel's Path to Pay. Nothing has been recorded for it yet.
        </p>
      )}
      {node.findings.length > 0 && (
        <section>
          <h3 className="eyebrow">Checks behind this step</h3>
          <ul className="mt-2 space-y-2">
            {node.findings.map((f) => (
              <li
                key={f.id}
                className={`rounded-lg border-l-4 bg-secondary/40 px-3 py-2 ${f.blocking ? "border-l-critical" : "border-l-warning"}`}
              >
                <p className="font-medium">
                  {f.title}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {f.blocking ? "blocks payment" : "advisory"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{f.why_it_matters ?? f.rationale}</p>
                {f.policy_ids.length > 0 && (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {f.policy_ids.map(policyLabel).join(" · ")}
                  </p>
                )}
                <Evidence items={f.evidence_refs} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {node.events.length > 0 && (
        <section>
          <h3 className="eyebrow">Recorded events ({node.events.length})</h3>
          <ol className="mt-2 space-y-2.5">
            {events.map((e) => (
              <li key={e.id} className="border-l-2 border-primary/40 pl-3">
                <p className="font-medium leading-snug">{e.label}</p>
                <p className="text-xs text-muted-foreground">
                  {e.actor_name ?? "Sentinel"} ·{" "}
                  {formatDate(e.occurred_at, { dateStyle: "medium", timeStyle: "short" })}
                  {isNotableResult(e.result) && <> · {plain(e.result)}</>}
                </p>
                {e.before_state && e.after_state && (
                  <p className="text-xs">
                    {plain(e.before_state)} → {plain(e.after_state)}
                  </p>
                )}
                {e.policy_ids.length > 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    {e.policy_ids.map(policyLabel).join(" · ")}
                  </p>
                )}
                <Evidence items={e.evidence_refs} />
              </li>
            ))}
          </ol>
          {node.events.length > 4 && (
            <Button
              variant="link"
              size="sm"
              className="h-auto px-0"
              onClick={() => setAll((v) => !v)}
            >
              {all ? "Show fewer" : `Expand details: show all ${node.events.length} events`}
            </Button>
          )}
        </section>
      )}
      {showActions && (
        <section>
          <h3 className="eyebrow">What can happen next</h3>
          {record.blocked_reasons.length > 0 && (
            <ul className="mt-2 list-inside list-disc text-xs text-muted-foreground">
              {record.blocked_reasons.map((r) => (
                <li key={r}>Blocked: {r}</li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Actions your role may take on this invoice now:{" "}
            {record.allowed_actions.length
              ? record.allowed_actions.map((a) => plain(a)).join(", ")
              : "none"}
            .
          </p>
        </section>
      )}
    </div>
  );
}
