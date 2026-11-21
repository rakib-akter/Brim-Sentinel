import { queryOptions } from "@tanstack/react-query";
import type { InvoiceListParams } from "@/lib/domain/types";
import { api } from "./client";

export const homeQuery = (actorId: string) =>
  queryOptions({ queryKey: ["home", actorId], queryFn: () => api.getHome(actorId) });

export const invoicesQuery = (actorId: string, params: InvoiceListParams) =>
  queryOptions({
    queryKey: ["invoices", actorId, params.q ?? "", params.status ?? "all"],
    queryFn: () => api.listInvoices(actorId, params),
  });

export const invoiceQuery = (actorId: string, invoiceId: string) =>
  queryOptions({
    queryKey: ["invoice", actorId, invoiceId],
    queryFn: () => api.getInvoice(actorId, invoiceId),
  });

export const notificationsQuery = (actorId: string) =>
  queryOptions({ queryKey: ["notifications", actorId], queryFn: () => api.listNotifications(actorId) });
