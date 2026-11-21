import { queryOptions } from "@tanstack/react-query";
import type { InvoiceListParams } from "@/lib/domain/types";
import { api } from "./client";
import { ApiError } from "./http-api";
import { presentDetail, presentInvoice } from "./presentation";

export const homeQuery = (actorId: string) =>
  queryOptions({
    queryKey: ["home", actorId],
    queryFn: async () => {
      const dashboard = await api.dashboard(actorId);
      const presentTask = (task: (typeof dashboard.needs_attention)[number]) =>
        presentInvoice({
          ...task.invoice,
          owner: task.owner,
          plain_status: task.plain_status,
          primary_action: task.primary_action,
        });
      return {
        needsAttention: dashboard.needs_attention.map(presentTask),
        readyForApproval: dashboard.ready_for_approval.map(presentTask),
        upcomingPayments: dashboard.upcoming_payments.map(presentTask),
        workItems: dashboard.work_items,
        metrics: {
          readyForApproval: dashboard.counts["ready_for_approval"] ?? 0,
          needsReview: dashboard.counts["open_work_items"] ?? 0,
          onHold: dashboard.counts["needs_attention"] ?? 0,
          upcomingPayments: dashboard.counts["upcoming_payments"] ?? 0,
        },
      };
    },
  });

export const invoicesQuery = (actorId: string, params: InvoiceListParams) =>
  queryOptions({
    queryKey: ["invoices", actorId, params.q ?? "", params.status ?? "all"],
    queryFn: async () => (await api.invoices(actorId, params)).map(presentInvoice),
  });

export const invoiceQuery = (actorId: string, invoiceId: string) =>
  queryOptions({
    queryKey: ["invoice", actorId, invoiceId],
    queryFn: async () => {
      try {
        const record = await api.invoice(actorId, invoiceId);
        return { ...presentDetail(record), record };
      } catch (error) {
        if (error instanceof ApiError && [403, 404].includes(error.status)) return null;
        throw error;
      }
    },
  });

export const meQuery = (actor: string) =>
  queryOptions({ queryKey: ["me", actor], queryFn: () => api.me(actor), staleTime: 30_000 });
export const identitiesQuery = () =>
  queryOptions({ queryKey: ["identities"], queryFn: api.identities, staleTime: 60_000 });
export const casesQuery = (actor: string, openOnly: boolean) =>
  queryOptions({ queryKey: ["cases", actor, openOnly], queryFn: () => api.cases(actor, openOnly) });
export const caseQuery = (actor: string, id: string) =>
  queryOptions({ queryKey: ["case", actor, id], queryFn: () => api.case(actor, id) });
export const paymentsQuery = (actor: string, state: string) =>
  queryOptions({ queryKey: ["payments", actor, state], queryFn: () => api.payments(actor, state) });
export const flightQuery = (actor: string, id: string) =>
  queryOptions({ queryKey: ["flight", actor, id], queryFn: () => api.flight(actor, id) });
