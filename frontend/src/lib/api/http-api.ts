import type * as Schema from "./schema";

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export const invoicePath = (id: string) => `/invoices/${encodeURIComponent(id)}`;
export const casePath = (id: string) => `/cases/${encodeURIComponent(id)}`;
const paymentPath = (id: string) => `/payments/${encodeURIComponent(id)}`;

export function createHttpApi(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, "").replace(/\/api\/v1$/, "") + "/api/v1";
  async function request(actor: string, path: string, init?: RequestInit) {
    const headers = new Headers(init?.headers);
    if (actor) headers.set("X-Demo-User-Id", actor);
    const res = await fetch(base + path, { ...init, headers, cache: "no-store" });
    if (!res.ok) {
      const body: Schema.ErrorResponse | undefined = await res.json().catch(() => undefined);
      throw new ApiError(
        res.status,
        body?.error?.code ?? "HTTP_ERROR",
        body?.error?.message ?? `Sentinel returned HTTP ${res.status}.`,
        body?.error?.details,
      );
    }
    return res;
  }

  const get = async <T>(actor: string, path: string): Promise<T> =>
    (await request(actor, path)).json();
  const write = async <T>(
    actor: string,
    path: string,
    body: object,
    method = "POST",
    extraHeaders?: Record<string, string>,
  ): Promise<T> =>
    (
      await request(actor, path, {
        method,
        body: JSON.stringify(body),
        headers: { "Content-Type": "application/json", ...extraHeaders },
      })
    ).json();

  return {
    identities: () => get<Schema.DemoIdentitiesOut>("", "/demo-identities"),
    me: (actor: string) => get<Schema.MeOut>(actor, "/me"),
    dashboard: (actor: string) => get<Schema.DashboardOut>(actor, "/dashboard"),
    async invoices(actor: string, filters: { q?: string; status?: string }) {
      const params = new URLSearchParams({ limit: "100" });
      if (filters.q) params.set("q", filters.q);
      if (filters.status && filters.status !== "all") params.set("status", filters.status);
      const items: Schema.InvoiceSummary[] = [];
      for (;;) {
        params.set("offset", String(items.length));
        const page = await get<Schema.InvoiceListOut>(actor, `/invoices?${params}`);
        items.push(...page.items);
        if (!page.items.length || items.length >= page.total) return items;
      }
    },
    invoice: (actor: string, id: string) => get<Schema.InvoiceDetail>(actor, invoicePath(id)),
    document: async (actor: string, id: string) =>
      (await request(actor, invoicePath(id) + "/document")).blob(),
    flight: (actor: string, id: string) =>
      get<Schema.FlightRecorderOut>(actor, invoicePath(id) + "/flight-recorder"),
    async upload(actor: string, file: File): Promise<Schema.UploadOut> {
      const body = new FormData();
      body.append("file", file);
      return (await request(actor, "/invoices/upload", { method: "POST", body })).json();
    },
    decide: (actor: string, id: string, step: string, body: Schema.ApprovalDecisionRequest) =>
      write<Schema.InvoiceDetail>(
        actor,
        `${invoicePath(id)}/approvals/${encodeURIComponent(step)}/decision`,
        body,
      ),
    revalidate: (actor: string, id: string, body: Schema.VersionedRequest) =>
      write<Schema.InvoiceDetail>(actor, invoicePath(id) + "/validate", body),
    edit: (actor: string, id: string, body: Schema.EditFieldsRequest) =>
      write<Schema.InvoiceDetail>(actor, invoicePath(id) + "/fields", body, "PATCH"),
    coding: (actor: string, id: string, body: Schema.CodingDecisionRequest) =>
      write<Schema.InvoiceDetail>(actor, invoicePath(id) + "/coding/decision", body),
    dismiss: (actor: string, id: string, finding: string, body: Schema.DismissRequest) =>
      write<Schema.InvoiceDetail>(
        actor,
        `${invoicePath(id)}/findings/${encodeURIComponent(finding)}/dismiss`,
        body,
      ),
    cancel: (actor: string, id: string, body: Schema.CancelRequest) =>
      write<Schema.InvoiceDetail>(actor, invoicePath(id) + "/cancel", body),
    cases: (actor: string, openOnly: boolean) =>
      get<Schema.CaseListOut>(actor, `/cases?open_only=${openOnly}`),
    case: (actor: string, id: string) => get<Schema.CaseDetail>(actor, casePath(id)),
    caseAction: (actor: string, id: string, body: Schema.CaseActionRequest) =>
      write<Schema.CaseDetail>(actor, casePath(id) + "/actions", body),
    verify: (actor: string, id: string, body: Schema.VerificationRequest) =>
      write<Schema.CaseDetail>(actor, casePath(id) + "/bank-verification", body),
    authorizeRoute: (actor: string, id: string, body: Schema.AuthorizeRouteRequest) =>
      write<Schema.CaseDetail>(actor, casePath(id) + "/route-authorization", body),
    requestAuthorization: (actor: string, id: string, body: Schema.AuthorizationRequestBody) =>
      write<Schema.CaseDetail>(actor, casePath(id) + "/authorization-request", body),
    payments: (actor: string, state: string) =>
      get<Schema.PaymentOut[]>(actor, `/payments?${new URLSearchParams({ state })}`),
    prepare: (actor: string, body: Schema.PrepareRequest) =>
      write<Schema.PaymentOut>(actor, "/payments/prepare", body),
    release: (actor: string, id: string, body: Schema.ReleaseRequest, key: string) =>
      write<Schema.ReleaseOut>(actor, paymentPath(id) + "/release", body, "POST", {
        "Idempotency-Key": key,
      }),
    settle: (actor: string, id: string, body: Schema.SettleRequest) =>
      write<Schema.PaymentOut>(actor, paymentPath(id) + "/simulate-settlement", body),
    audit: (actor: string, params: URLSearchParams) =>
      get<Schema.AuditListOut>(actor, `/audit/events?${params}`),
    exportAudit: async (actor: string, params: URLSearchParams) =>
      (await request(actor, `/audit/export.csv?${params}`)).blob(),
    verifyAudit: (actor: string) =>
      get<{ valid: boolean; events_checked: number; broken_at_event_id?: number }>(
        actor,
        "/audit/verify-chain",
      ),
  };
}
