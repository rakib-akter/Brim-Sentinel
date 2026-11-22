import { describe, expect, it } from "vitest";
import {
  actionLabel,
  describeData,
  evidenceLabel,
  isNotableResult,
  lookupLabel,
  plain,
  policyLabel,
} from "./plain-language";

describe("plain-language", () => {
  it("turns backend codes into customer wording", () => {
    expect(plain("ON_HOLD")).toBe("Payment paused");
    expect(plain("PENDING_INDEPENDENT_VERIFICATION")).toBe("Waiting for supplier verification");
    expect(plain("awaiting_verification")).toBe("Waiting for supplier verification");
    expect(plain("email_request")).toBe("Email request");
    expect(plain("trusted_callback")).toBe("Call the supplier on a number already on file");
  });

  it("never shows SHOUTING_CASE for unknown codes", () => {
    expect(plain("SOME_NEW_CODE")).toBe("Some new code");
    expect(plain("gl_account")).toBe("GL account");
    expect(plain(null)).toBe("");
  });

  it("describes evidence without raw JSON", () => {
    expect(evidenceLabel({ type: "bank_change", ref: "BC-009" })).toBe(
      "Bank change request BC-009",
    );
    expect(evidenceLabel({ type: "document_field", ref: "po_number", label: "blank" })).toBe(
      "Invoice document · PO number: blank",
    );
    expect(evidenceLabel("get_bank_changes#2")).toBe("Read the bank change history");
    expect(evidenceLabel({ type: "vendor", ref: "V004" })).not.toContain("{");
  });

  it("explains rules, lookups, actions and data", () => {
    expect(policyLabel("P11")).toBe(
      "Rule P11: whoever approved an invoice can't release its payment",
    );
    expect(lookupLabel("get_card_transactions#5")).toBe("Looked for matching Brim card charges");
    expect(actionLabel("payment.released")).toBe("Payment released (simulated)");
    expect(describeData({ method: "PHONE_CALLBACK_TO_CONTACT_ON_FILE", note: null })).toEqual([
      "Method: Phone callback to contact on file",
    ]);
  });

  it("hides routine results", () => {
    expect(isNotableResult("SUCCESS")).toBe(false);
    expect(isNotableResult("INFO")).toBe(false);
    expect(isNotableResult("DENIED")).toBe(true);
  });
});
