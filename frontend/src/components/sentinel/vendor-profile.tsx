import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api } from "@/lib/api/client";
import { casesQuery, invoicesQuery, vendorQuery } from "@/lib/api/queries";
import type { BankChangeCreate, BankChangeOut, VendorDetail } from "@/lib/api/schema";
import { formatMoney } from "@/lib/format";
import { useSession } from "@/lib/session";
import { BankAuthorizationForm, BankVerificationForm } from "./bank-change-forms";
import { InvoiceTable } from "./invoice-table";
import { PageHeader } from "./page-header";
import { QueryState } from "./query-state";
import { Choice, Field, humanize, value, WorkflowForm } from "./workflow-form";

const channels: { value: BankChangeCreate["request_channel"]; label: string }[] = [
  { value: "email_request", label: "Email" },
  { value: "phone_inbound", label: "Incoming phone call" },
  { value: "vendor_portal", label: "Vendor portal" },
  { value: "letter", label: "Letter" },
];

export function VendorProfile({ id }: { id: string }) {
  const { user } = useSession();
  const vendor = useQuery(vendorQuery(user.id, id));
  if (vendor.error || vendor.isPending) {
    return (
      <section className="surface">
        <QueryState
          error={vendor.error}
          loading="Loading supplier profile…"
          retry={vendor.refetch}
        />
      </section>
    );
  }
  return <Profile vendor={vendor.data} />;
}

function Profile({ vendor }: { vendor: VendorDetail }) {
  const { user, permissions } = useSession();
  return (
    <div className="min-w-0 space-y-6">
      <PageHeader
        eyebrow="Supplier profile"
        title={vendor.legal_name}
        description={[
          vendor.id,
          humanize(vendor.status),
          vendor.category,
          vendor.province_or_state,
          vendor.country,
        ]
          .filter(Boolean)
          .join(" · ")}
      />
      <section className="surface space-y-3 px-5 py-4 text-sm">
        <h2 className="font-semibold">Supplier and payment details</h2>
        <dl className="grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Purchase order</dt>
            <dd>{vendor.requires_po ? "Required" : "Optional"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Payment terms</dt>
            <dd>
              {vendor.payment_terms_days === null
                ? "Unavailable"
                : `${vendor.payment_terms_days} days`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Account on file</dt>
            <dd>{vendor.bank_account_masked ?? "No account on file"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Open payables</dt>
            <dd>{formatMoney(vendor.open_payable_minor)} CAD</dd>
          </div>
        </dl>
        {vendor.routes.length ? (
          <ul className="space-y-1">
            {vendor.routes.map((route) => (
              <li key={route.id}>
                {route.method} · {humanize(route.status)}
                {route.account_masked && ` · ${route.account_masked}`}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground">No payment routes on file.</p>
        )}
      </section>
      {vendor.similar_identities.length > 0 && (
        <section className="surface space-y-2 px-5 py-4 text-sm">
          <h2 className="font-semibold">Possible duplicate supplier records</h2>
          <ul className="space-y-1">
            {vendor.similar_identities.map((candidate) => {
              const id = String(candidate["vendor_id"]);
              return (
                <li key={id}>
                  <Link
                    className="text-primary hover:underline"
                    to="/vendors"
                    from="/vendors"
                    search={(search) => ({ ...search, vendorId: id })}
                  >
                    {String(candidate["legal_name"])}
                  </Link>{" "}
                  · {humanize(String(candidate["status"]))}
                </li>
              );
            })}
          </ul>
        </section>
      )}
      {["pending_review", "new"].includes(vendor.status) &&
        permissions.includes("vendor.activate") && (
          <section className="surface space-y-3 px-5 py-4">
            <h2 className="font-semibold">Review onboarding</h2>
            <p className="text-sm text-muted-foreground">
              An independent reviewer must document the supplier identity checks before activation.
            </p>
            <WorkflowForm
              label="Activate vendor"
              run={(fields) =>
                api.activateVendor(user.id, vendor.id, { notes: value(fields, "notes") })
              }
            >
              <Field label="Identity checks performed" name="notes" />
            </WorkflowForm>
          </section>
        )}
      <section className="surface space-y-4 px-5 py-4">
        <h2 className="font-semibold">Bank-change history</h2>
        {vendor.has_open_bank_change && (
          <p className="text-sm font-medium">
            Bank change under review. Affected payments are paused.
          </p>
        )}
        {permissions.includes("bank_change.request") && <BankChangeRequest vendorId={vendor.id} />}
        {vendor.bank_changes.length === 0 && (
          <p className="text-sm text-muted-foreground">No bank changes recorded.</p>
        )}
        {[...vendor.bank_changes].reverse().map((bank) => (
          <BankChange key={bank.id} bank={bank} />
        ))}
      </section>
      <details className="surface px-5 py-4 text-sm">
        <summary className="cursor-pointer font-semibold">Contacts and contracts</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div className="min-w-0">
            <h3 className="font-medium">Contacts</h3>
            {vendor.contacts.length ? (
              <ul className="space-y-2">
                {vendor.contacts.map((contact) => (
                  <li key={contact.id} className="break-words">
                    {contact.value} · {humanize(contact.source)} · On file since{" "}
                    {contact.established_at}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No contacts on file.</p>
            )}
          </div>
          <div>
            <h3 className="font-medium">Contracts</h3>
            {vendor.contracts.length ? (
              <ul className="space-y-2">
                {vendor.contracts.map((contract) => (
                  <li key={String(contract["id"])}>
                    {String(contract["description"])} · {humanize(String(contract["status"]))}
                    <p className="text-muted-foreground">
                      {String(contract["id"])} · {String(contract["start_date"] ?? "Unknown start")}{" "}
                      to {String(contract["end_date"] ?? "Open end")}
                    </p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-muted-foreground">No contracts on file.</p>
            )}
          </div>
        </div>
      </details>
      <RelatedInvoices vendorId={vendor.id} legalName={vendor.legal_name} />
    </div>
  );
}

function RelatedInvoices({ vendorId, legalName }: { vendorId: string; legalName: string }) {
  const { user } = useSession();
  const [includeHistory, setIncludeHistory] = useState(false);
  const invoices = useQuery(invoicesQuery(user.id, { q: legalName, includeHistory }));
  const tasks = invoices.data?.filter(({ record }) => record?.vendor_id === vendorId) ?? [];
  return (
    <section className="surface overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="font-semibold">Related invoices</h2>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeHistory}
            onChange={(event) => setIncludeHistory(event.target.checked)}
          />
          Include historical invoices
        </label>
      </div>
      {invoices.error || invoices.isPending ? (
        <QueryState loading="Loading invoices…" error={invoices.error} retry={invoices.refetch} />
      ) : tasks.length ? (
        <InvoiceTable tasks={tasks} caption="Related invoices" />
      ) : (
        <p className="p-5 text-sm text-muted-foreground">No related invoices in this view.</p>
      )}
    </section>
  );
}

function BankChangeRequest({ vendorId }: { vendorId: string }) {
  const { user } = useSession();
  return (
    <details className="space-y-3 rounded-lg border p-4">
      <summary className="cursor-pointer text-sm font-medium">Request a bank change</summary>
      <WorkflowForm
        label="Submit bank-change request"
        clearOnSuccess
        success="Bank-change request recorded."
        run={(fields) => {
          const channel = channels.find((option) => option.value === value(fields, "channel"));
          if (!channel) throw new Error("Choose how the request was received.");
          const institution = value(fields, "institution");
          const transit = value(fields, "transit");
          const account = value(fields, "account");
          if (![institution, transit, account].every((part) => /^[0-9]+$/.test(part))) {
            throw new Error("Use digits for the institution, transit and account numbers.");
          }
          return api.requestBankChange(user.id, vendorId, {
            institution,
            transit,
            account,
            request_channel: channel.value,
            evidence_ref: value(fields, "evidence") || null,
          });
        }}
      >
        <p className="text-sm text-muted-foreground">
          The new payment route requires independent supplier verification and finance
          authorization.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field
            label="Institution number"
            name="institution"
            inputMode="numeric"
            autoComplete="off"
          />
          <Field label="Transit number" name="transit" inputMode="numeric" autoComplete="off" />
          <Field
            label="Account number"
            name="account"
            type="password"
            inputMode="numeric"
            autoComplete="off"
          />
        </div>
        <Choice label="Request channel" name="channel" options={channels} />
        <Field label="Request evidence reference (optional)" name="evidence" required={false} />
      </WorkflowForm>
    </details>
  );
}

function BankChange({ bank }: { bank: BankChangeOut }) {
  const { user } = useSession();
  const cases = useQuery(casesQuery(user.id, true));
  const related = cases.data?.items.filter((item) => item.bank_change_id === bank.id) ?? [];
  return (
    <article className="space-y-3 rounded-lg border p-4 text-sm">
      <h3 className="font-medium">
        {humanize(bank.state)} · {bank.id}
      </h3>
      <p>
        {bank.old_account_masked ?? "No prior account"} → {bank.new_account_masked ?? "Unavailable"}
      </p>
      <p className="text-muted-foreground">
        {bank.requested_at} · {humanize(bank.request_channel)}
      </p>
      {bank.state === "PENDING_INDEPENDENT_VERIFICATION" && !bank.trusted_contacts.length && (
        <p>
          No trusted contact predates this request. Escalate to finance to review supplier contact
          records.
        </p>
      )}
      {bank.verification_outcome && (
        <details>
          <summary className="cursor-pointer">
            Verification {humanize(bank.verification_outcome)}
          </summary>
          <dl className="mt-2 space-y-1 break-words text-muted-foreground">
            <div>
              <dt className="inline font-medium">Verified by </dt>
              <dd className="inline">{bank.verifier_id}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Trusted contact </dt>
              <dd className="inline">{bank.trusted_contact_id}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Recorded at </dt>
              <dd className="inline">{bank.verification_occurred_at}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Evidence </dt>
              <dd className="inline">{bank.verification_evidence_ref}</dd>
            </div>
          </dl>
        </details>
      )}
      {bank.authorized_by_id && (
        <p>
          Authorized by {bank.authorized_by_id} · {bank.authorized_at}
        </p>
      )}
      {related.length > 0 && (
        <ul className="space-y-1">
          {related.map((item) => (
            <li key={item.id}>
              <Link
                className="text-primary hover:underline"
                to="/investigations"
                search={{ caseId: item.id, history: undefined }}
              >
                Open verification wizard for {item.invoice_id}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <BankVerificationForm
        bank={bank}
        submit={(request) => api.verifyBankChange(user.id, bank.id, request)}
      />
      <BankAuthorizationForm
        bank={bank}
        submit={(request) => api.authorizeBankChange(user.id, bank.id, request)}
      />
    </article>
  );
}
