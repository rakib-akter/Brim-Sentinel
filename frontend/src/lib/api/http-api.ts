/**
 * Thin HTTP client for the future FastAPI backend. Endpoint paths are a draft;
 * replace with the generated OpenAPI client once the backend contract is frozen.
 * The selected demo identity is sent as a header — a simulation, not authentication.
 */
import type { SentinelApi } from "./contract";

export function createHttpApi(baseUrl: string): SentinelApi {
  const request = async <T>(actorId: string, path: string, init?: RequestInit): Promise<T> => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { "content-type": "application/json", "x-demo-actor": actorId, ...init?.headers },
    });
    if (!res.ok) throw new Error(`Sentinel API ${res.status} on ${path}`);
    return (await res.json()) as T;
  };

  return {
    getHome: (actor) => request(actor, "/home"),
    listInvoices: (actor, params) => {
      const qs = new URLSearchParams();
      if (params.q) qs.set("q", params.q);
      if (params.status) qs.set("status", params.status);
      return request(actor, `/invoices?${qs.toString()}`);
    },
    getInvoice: (actor, id) => request(actor, `/invoices/${encodeURIComponent(id)}`),
    uploadInvoice: (actor, input) =>
      request(actor, "/invoices/uploads", { method: "POST", body: JSON.stringify(input) }),
    listNotifications: (actor) => request(actor, "/notifications"),
  };
}
