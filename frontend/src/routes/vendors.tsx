import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { EmptyState } from "@/components/sentinel/empty-state";
import { PageHeader } from "@/components/sentinel/page-header";
import { QueryState } from "@/components/sentinel/query-state";
import { Field, humanize, value, WorkflowForm } from "@/components/sentinel/workflow-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api/client";
import { vendorsQuery } from "@/lib/api/queries";
import { useSession } from "@/lib/session";
import { VendorProfile } from "@/components/sentinel/vendor-profile";

const statuses = ["active", "pending_review", "new", "on_hold", "inactive", "blocked"];

export const Route = createFileRoute("/vendors")({
  validateSearch: (search: Record<string, unknown>) => ({
    q: typeof search["q"] === "string" ? search["q"].trim() : "",
    status:
      typeof search["status"] === "string" && statuses.includes(search["status"])
        ? search["status"]
        : "",
    vendorId: typeof search["vendorId"] === "string" ? search["vendorId"] : undefined,
  }),
  head: () => ({ meta: [{ title: "Vendors — Brim Sentinel" }] }),
  component: Vendors,
});

function Vendors() {
  const search = Route.useSearch();
  if (search.vendorId)
    return (
      <div className="space-y-4">
        <Link
          className="text-sm font-medium text-primary hover:underline"
          to="/vendors"
          search={{ ...search, vendorId: undefined }}
        >
          Back to vendor directory
        </Link>
        <VendorProfile key={search.vendorId} id={search.vendorId} />
      </div>
    );
  return <VendorDirectory />;
}

function VendorDirectory() {
  const { user, permissions } = useSession();
  const search = Route.useSearch();
  const navigate = useNavigate({ from: "/vendors" });
  const result = useQuery(vendorsQuery(user.id, search.q, search.status));
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Work"
        title="Vendors"
        description="Find supplier records, payment routes and bank-change history."
      />
      {permissions.includes("vendor.onboard_request") && (
        <details className="surface space-y-4 px-5 py-4">
          <summary className="cursor-pointer font-medium">Request vendor onboarding</summary>
          <WorkflowForm
            label="Submit onboarding request"
            run={async (fields) => {
              const legalName = value(fields, "legal_name");
              if (!legalName) throw new Error("Enter the supplier’s legal name.");
              const vendor = await api.onboardVendor(user.id, {
                legal_name: legalName,
                category: value(fields, "category") || null,
                country: value(fields, "country") || "CA",
                province: value(fields, "province") || null,
                gst_hst_number: value(fields, "gst_hst_number") || null,
                contact_email: value(fields, "contact_email") || null,
              });
              await navigate({ search: { ...search, vendorId: vendor.id } });
            }}
          >
            <p className="text-sm text-muted-foreground">
              The supplier will be pending review until an independent reviewer checks its identity.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Legal name" name="legal_name" />
              <Field label="Category (optional)" name="category" required={false} />
              <Field label="Country code" name="country" defaultValue="CA" />
              <Field label="Province or state (optional)" name="province" required={false} />
              <Field label="GST/HST number (optional)" name="gst_hst_number" required={false} />
              <Field
                label="Contact email (optional)"
                name="contact_email"
                type="email"
                required={false}
              />
            </div>
          </WorkflowForm>
        </details>
      )}
      <section className="surface overflow-hidden">
        <form
          key={JSON.stringify([search.q, search.status])}
          className="flex flex-wrap items-end gap-3 border-b px-5 py-4"
          onSubmit={(event) => {
            event.preventDefault();
            const fields = new FormData(event.currentTarget);
            void navigate({
              search: {
                q: value(fields, "q"),
                status: value(fields, "status"),
                vendorId: undefined,
              },
            });
          }}
        >
          <Field label="Supplier name or ID" name="q" defaultValue={search.q} required={false} />
          <label className="block text-sm">
            Supplier status
            <select
              name="status"
              defaultValue={search.status}
              className="mt-1 block rounded-md border bg-background p-2"
            >
              <option value="">All statuses</option>
              {statuses.map((status) => (
                <option key={status} value={status}>
                  {humanize(status)}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit">Search vendors</Button>
          {(search.q || search.status) && (
            <Link
              to="/vendors"
              search={{ q: "", status: "", vendorId: undefined }}
              className="p-2 text-sm text-primary hover:underline"
            >
              Clear filters
            </Link>
          )}
        </form>
        {result.error || result.isPending ? (
          <QueryState error={result.error} loading="Loading vendors…" retry={result.refetch} />
        ) : result.data.length === 0 ? (
          <EmptyState
            icon={Building2}
            title="No vendors found"
            body="Try another supplier name or clear your filters."
          />
        ) : (
          <ul className="divide-y">
            {result.data.map((vendor) => (
              <li
                key={vendor.id}
                className="flex flex-wrap items-center justify-between gap-2 px-5 py-4 text-sm"
              >
                <div>
                  <Link
                    className="font-medium text-primary hover:underline"
                    to="/vendors"
                    search={{ ...search, vendorId: vendor.id }}
                  >
                    {vendor.legal_name}
                  </Link>
                  <p className="text-muted-foreground">
                    {[vendor.id, vendor.category, vendor.province_or_state, vendor.country]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge variant="secondary">{humanize(vendor.status)}</Badge>
                  {vendor.has_open_bank_change && (
                    <Badge variant="outline">Bank change under review</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
