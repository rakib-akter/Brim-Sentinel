/**
 * The API contract the UI depends on. The mock implementation and the future
 * FastAPI client (generated from OpenAPI) both satisfy this interface.
 */
import type {
  HomeSummary,
  InvoiceDetail,
  InvoiceListParams,
  InvoiceTask,
  NotificationItem,
  UploadInvoiceInput,
} from "@/lib/domain/types";

export interface SentinelApi {
  getHome(actorId: string): Promise<HomeSummary>;
  listInvoices(actorId: string, params: InvoiceListParams): Promise<InvoiceTask[]>;
  getInvoice(actorId: string, invoiceId: string): Promise<InvoiceDetail | null>;
  uploadInvoice(actorId: string, input: UploadInvoiceInput): Promise<InvoiceTask>;
  listNotifications(actorId: string): Promise<NotificationItem[]>;
}
