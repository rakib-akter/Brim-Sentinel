import type { AuthorizeRouteRequest, BankChangeOut, VerificationRequest } from "@/lib/api/schema";
import { Choice, Field, value, WorkflowForm } from "./workflow-form";
import { plain } from "@/lib/plain-language";

export function BankVerificationForm({
  bank,
  submit,
}: {
  bank: BankChangeOut;
  submit: (request: VerificationRequest) => Promise<unknown>;
}) {
  if (!bank.allowed_actions.includes("record_verification") || !bank.trusted_contacts.length)
    return null;
  return (
    <WorkflowForm
      label="Record supplier verification"
      key={bank.row_version}
      run={(fields) =>
        submit({
          expected_row_version: bank.row_version,
          trusted_contact_id: value(fields, "contact"),
          method: "phone_callback_to_contact_on_file",
          occurred_at: new Date(value(fields, "occurred")).toISOString(),
          outcome: value(fields, "outcome") === "CONFIRMED" ? "CONFIRMED" : "DENIED",
          notes: value(fields, "notes"),
          evidence_ref: value(fields, "evidence"),
        })
      }
    >
      <p className="text-sm">
        Call a trusted contact already on file and record the actual outcome.
      </p>
      <Choice
        label="Trusted contact"
        name="contact"
        options={bank.trusted_contacts.map((contact) => ({
          value: contact.id,
          label: `${contact.value} · ${plain(contact.source)} · On file since ${contact.established_at}`,
        }))}
      />
      <Field label="Callback time (local time)" name="occurred" type="datetime-local" />
      <Choice
        label="Callback outcome"
        name="outcome"
        options={[
          { value: "CONFIRMED", label: "Supplier confirmed the change" },
          { value: "DENIED", label: "Supplier denied the change" },
        ]}
      />
      <Field label="Call log reference" name="evidence" />
      <Field label="Verification notes" name="notes" />
    </WorkflowForm>
  );
}

export function BankAuthorizationForm({
  bank,
  submit,
}: {
  bank: BankChangeOut;
  submit: (request: AuthorizeRouteRequest) => Promise<unknown>;
}) {
  if (!bank.allowed_actions.includes("authorize_route")) return null;
  return (
    <WorkflowForm
      label="Authorize verified EFT change"
      run={(fields) =>
        submit({
          expected_row_version: bank.row_version,
          notes: value(fields, "notes"),
        })
      }
    >
      <Field label="Finance authorization rationale" name="notes" />
    </WorkflowForm>
  );
}
