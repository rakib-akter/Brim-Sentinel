import { useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { ArrowRight, Check, RotateCcw, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSession } from "@/lib/session";

/**
 * "Start here": the Detect → Resolve → Settle → Explain story in five clicks. Each step switches to
 * the person who is allowed to do it (demo identity) and opens the right screen. Progress is a
 * per-browser convenience only; the backend still decides what each person may do.
 */
const CASCADIA = "/invoices/IN-EM-019-1";

const STEPS = [
  {
    id: "detect",
    stage: "Detect",
    title: "See why Cascadia's payment is paused",
    body: "The bank account changed by email and nobody has verified it.",
    as: "U004",
    asName: "Jordan Okafor · AP clerk",
    path: CASCADIA,
  },
  {
    id: "resolve",
    stage: "Resolve",
    title: "Ask Sentinel AI, then verify the supplier",
    body: "Read the cited investigation and record a call to a contact already on file.",
    as: "U004",
    asName: "Jordan Okafor · AP clerk",
    path: `${CASCADIA}#resolution`,
  },
  {
    id: "approve",
    stage: "Settle",
    title: "Approve an invoice waiting for you",
    body: "Approvals follow the rules; nobody can approve their own invoice.",
    as: "U007",
    asName: "Dev Malhotra · Department approver",
    path: "/approvals",
  },
  {
    id: "release",
    stage: "Settle",
    title: "Release a simulated payment",
    body: "Someone who didn't approve it must release it. Try releasing as the approver to see it refused.",
    as: "U003",
    asName: "Elise Tremblay · Finance manager",
    path: "/payments",
  },
  {
    id: "explain",
    stage: "Explain",
    title: "Replay the payment journey",
    body: "Every step, who did it and the evidence, recorded as it happened.",
    as: "U006",
    asName: "Hannah Lindqvist · Auditor (read-only)",
    path: `${CASCADIA}#explain`,
  },
] as const;

const KEY = "sentinel-guide";

function load(): { done: string[]; hidden: boolean } {
  try {
    const raw = window.localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as { done?: unknown; hidden?: unknown }) : {};
    return {
      done: Array.isArray(parsed.done) ? parsed.done.map(String) : [],
      hidden: parsed.hidden === true,
    };
  } catch {
    return { done: [], hidden: false };
  }
}

function save(state: { done: string[]; hidden: boolean }) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* storage unavailable: progress just isn't remembered */
  }
}

export function GuidedDemo() {
  const { user, users, setUserId } = useSession();
  const router = useRouter();
  const [state, setState] = useState<{ done: string[]; hidden: boolean } | null>(null);
  useEffect(() => setState(load()), []);
  if (!state) return null; // client-only: avoids a server/client mismatch
  const update = (next: { done: string[]; hidden: boolean }) => {
    setState(next);
    save(next);
  };
  if (state.hidden) {
    return (
      <button
        type="button"
        onClick={() => update({ ...state, hidden: false })}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
      >
        <Sparkles className="size-4" aria-hidden /> Show the guided demo
      </button>
    );
  }
  const nextIndex = STEPS.findIndex((s) => !state.done.includes(s.id));
  const go = (step: (typeof STEPS)[number]) => {
    update({ ...state, done: Array.from(new Set([...state.done, step.id])) });
    if (user.id === step.as || !users.some((u) => u.id === step.as)) {
      router.history.push(step.path);
    } else {
      setUserId(step.as, step.path);
    }
  };
  return (
    <section className="surface rise-in overflow-hidden" aria-labelledby="guide-heading">
      <header className="flex flex-wrap items-start gap-3 border-b bg-primary-soft/40 px-5 py-4">
        <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary text-primary-foreground">
          <Sparkles className="size-4" aria-hidden />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="guide-heading" className="text-[15px] font-semibold tracking-tight">
            Start here: one invoice from inbox to payment
          </h2>
          <p className="text-xs text-muted-foreground">
            Five steps. Each one switches to the person allowed to do it. {state.done.length}/
            {STEPS.length} done.
          </p>
        </div>
        <div className="flex items-center gap-1">
          {state.done.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => update({ ...state, done: [] })}
              aria-label="Restart the guided demo"
            >
              <RotateCcw aria-hidden /> Restart
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => update({ ...state, hidden: true })}
            aria-label="Hide the guided demo"
          >
            <X aria-hidden />
          </Button>
        </div>
      </header>
      <div
        className="h-1 bg-secondary"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={STEPS.length}
        aria-valuenow={state.done.length}
        aria-label="Guided demo progress"
      >
        <div
          className="h-full bg-primary transition-[width] duration-500 ease-out"
          style={{ width: `${(state.done.length / STEPS.length) * 100}%` }}
        />
      </div>
      <ol className="stagger grid gap-px bg-border sm:grid-cols-5">
        {STEPS.map((step, i) => {
          const done = state.done.includes(step.id);
          const next = i === nextIndex;
          return (
            <li
              key={step.id}
              className={`flex flex-col bg-card px-4 py-3 ${next ? "bg-primary-soft/30" : ""}`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold transition-colors ${
                    done
                      ? "bg-success-soft text-success-foreground"
                      : next
                        ? "bg-primary text-primary-foreground"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {done ? <Check className="size-3.5" aria-label="Done" /> : i + 1}
                </span>
                <span className="eyebrow">{step.stage}</span>
              </div>
              <p className="mt-2 text-sm font-medium leading-snug">{step.title}</p>
              <p className="mt-1 flex-1 text-xs text-muted-foreground">{step.body}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">As {step.asName}</p>
              <Button
                size="sm"
                variant={next ? "default" : "outline"}
                className="mt-2 self-start"
                onClick={() => go(step)}
              >
                {done ? "Open again" : "Go"} <ArrowRight aria-hidden />
              </Button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
