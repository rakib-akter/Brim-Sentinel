// DTOs from backend/openapi.json.
export interface ActivateRequest {
  notes: string;
}

export interface AnomalyOut {
  method_version: string;
  status: string;
  band: string;
  score: string;
  as_of: string;
  label?: string;
  signals: Array<Record<string, unknown>>;
  inputs: Record<string, unknown>;
}

export interface ApprovalDecisionRequest {
  expected_version: number;
  decision: "APPROVED" | "REJECTED";
  reason?: string | null;
}

export interface ApprovalStepOut {
  id: string;
  step_index: number;
  step_key: string;
  required_role: string;
  trigger_policy_ids: Array<string>;
  eligible_actor_ids: Array<string>;
  assigned_actor_id: string | null;
  assigned_actor_name: string | null;
  delegated_from_id: string | null;
  escalation_reason: string | null;
  status: "APPROVED" | "REJECTED" | "PENDING" | "WAITING";
  decided_by_id: string | null;
  decided_at: string | null;
  decision_reason: string | null;
}

export interface AuditEventOut {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_kind: string;
  action: string;
  object_type: string;
  object_id: string;
  object_version: number | null;
  invoice_id: string | null;
  result: string;
  policy_ids: Array<string>;
  evidence_refs: Array<unknown>;
  before_state: string | null;
  after_state: string | null;
  details: Record<string, unknown>;
  hash: string;
  prev_hash: string | null;
}

export interface AuditListOut {
  items: Array<AuditEventOut>;
  total: number;
  limit: number;
  offset: number;
}

export interface AuthorizationRequestBody {
  expected_invoice_version: number;
  notes?: string | null;
}

export interface AuthorizeRouteRequest {
  expected_row_version?: number | null;
  notes: string;
}

export interface BankChangeCreate {
  institution: string;
  transit: string;
  account: string;
  request_channel: "email_request" | "phone_inbound" | "vendor_portal" | "letter";
  evidence_ref?: string | null;
}

export interface BankChangeOut {
  id: string;
  vendor_id: string;
  requested_at: string;
  requested_by_user_id: string | null;
  request_channel: string;
  old_account_masked: string | null;
  new_account_masked: string | null;
  state: string;
  source: string;
  verifier_id: string | null;
  trusted_contact_id: string | null;
  verification_method: string | null;
  verification_occurred_at: string | null;
  verification_outcome: string | null;
  verification_evidence_ref: string | null;
  authorized_by_id: string | null;
  authorized_at: string | null;
  row_version: number;
  trusted_contacts: Array<ContactOut>;
  allowed_actions: Array<string>;
}

export interface Body_upload_api_v1_invoices_upload_post {
  file: string;
}

export interface CancelRequest {
  expected_version: number;
  reason: string;
}

export interface CaseActionOut {
  id: string;
  action_type: string;
  status: string;
  actor_id: string | null;
  notes: string | null;
  data: Record<string, unknown>;
  created_at: string;
}

export interface CaseActionRequest {
  action_type: "note" | "request_information" | "escalate" | "document_decision";
  notes?: string | null;
  decision?: "reject_invoice" | "keep_on_hold" | null;
  expected_row_version?: number | null;
}

export interface CaseDetail {
  id: string;
  invoice_id: string;
  invoice_version: number;
  case_type: string;
  title: string;
  state: string;
  severity: string;
  owner_role: string;
  owner_id: string | null;
  finding_ids: Array<string>;
  bank_change_id: string | null;
  closure_outcome: string | null;
  row_version: number;
  allowed_actions: Array<string>;
  created_at: string;
  updated_at: string;
  path_to_pay_steps: Array<Record<string, unknown>>;
  findings: Array<FindingOut>;
  actions: Array<CaseActionOut>;
  evidence_refs: Array<Record<string, unknown>>;
  bank_change: BankChangeOut | null;
  wizard: WizardOut | null;
  invoice: InvoiceSummary;
}

export interface CaseListOut {
  items: Array<CaseSummary>;
  total: number;
}

export interface CaseSummary {
  id: string;
  invoice_id: string;
  invoice_version: number;
  case_type: string;
  title: string;
  state: string;
  severity: string;
  owner_role: string;
  owner_id: string | null;
  finding_ids: Array<string>;
  bank_change_id: string | null;
  closure_outcome: string | null;
  row_version: number;
  allowed_actions: Array<string>;
  created_at: string;
  updated_at: string;
}

export interface CodingDecisionRequest {
  expected_version: number;
  lines: Array<CodingLine>;
}

export interface CodingLine {
  line_no: number;
  gl_account?: string | null;
  department_id?: string | null;
  reason?: string | null;
}

export interface ContactOut {
  id: string;
  channel: string;
  value: string;
  source: string;
  established_at: string;
}

export interface DashboardOut {
  actor_id: string;
  role: string;
  counts: Record<string, number>;
  needs_attention: Array<TaskOut>;
  ready_for_approval: Array<TaskOut>;
  upcoming_payments: Array<TaskOut>;
  work_items: Array<WorkItemOut>;
  demo_notice?: string;
}

export interface DemoIdentitiesOut {
  demo_notice?: string;
  users: Array<UserOut>;
}

export interface DismissRequest {
  expected_version: number;
  reason: string;
}

export interface DuplicateOut {
  id: string;
  match_type: string;
  confirmed: boolean;
  score: number;
  matched_invoice_id: string | null;
  matched_card_txn_id: string | null;
  reasons: Array<string>;
}

export interface EditFieldsRequest {
  expected_version: number;
  reason: string;
  fields: Record<string, unknown>;
}

export interface ErrorBody {
  code: string;
  message: string;
  details?: Record<string, unknown>;
  correlation_id: string;
}

export interface ErrorResponse {
  error: ErrorBody;
}

export interface FindingOut {
  id: string;
  invoice_id: string;
  version: number;
  check: string;
  code: string;
  result: "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
  severity: string;
  blocking: boolean;
  dismissible: boolean;
  title: string;
  rationale: string;
  why_it_matters: string | null;
  next_action: string | null;
  policy_ids: Array<string>;
  evidence_refs: Array<Record<string, unknown>>;
  data: Record<string, unknown>;
  dismissed_by: string | null;
  dismissal_reason: string | null;
}

export interface FlightEvent {
  kind: "persisted" | "proposed";
  id: string;
  occurred_at: string | null;
  actor_id: string | null;
  actor_name: string | null;
  action: string;
  label: string;
  before_state: string | null;
  after_state: string | null;
  result: string | null;
  policy_ids: Array<string>;
  evidence_refs: Array<unknown>;
}

export interface FlightRecorderOut {
  invoice_id: string;
  as_of: string;
  events: Array<FlightEvent>;
  proposed_next: Array<FlightEvent>;
  note?: string;
}

export interface ImportOut {
  counts: Record<string, unknown>;
}

export interface InvestigationOut {
  summary: string;
  evidence: Array<string>;
  proposed_actions: Array<string>;
  open_questions: Array<string>;
  complete: boolean;
  source: "deterministic_template" | "model";
  rejected_reason: string | null;
  lookups: Array<Record<string, unknown>>;
  case_state_unchanged: boolean;
  proposals_status: string;
}

export interface InvoiceDetail {
  id: string;
  invoice_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  version: number;
  row_version: number;
  kind: "invoice" | "credit_note";
  currency: string | null;
  amount_minor: number | null;
  amount_cad_minor: number | null;
  invoice_date: string | null;
  due_date: string | null;
  lifecycle_state: string;
  plain_status: string;
  risk_band: string | null;
  risk_score: string | null;
  blocking_findings_count: number;
  allowed_actions: Array<string>;
  blocked_reasons: Array<string>;
  source_kind: string;
  department_id: string | null;
  requester_id: string | null;
  owner: string | null;
  primary_action: PrimaryAction;
  provenance: string;
  language: string | null;
  document_refs: Array<Record<string, unknown>>;
  extracted_fields: Record<string, unknown>;
  uncertain_fields: Array<string>;
  line_items: Array<LineOut>;
  taxes: Array<Record<string, unknown>>;
  subtotal_minor: number | null;
  fx: Record<string, unknown> | null;
  remit: Record<string, unknown>;
  validation_findings: Array<FindingOut>;
  duplicate_candidates: Array<DuplicateOut>;
  approval_chain: Array<ApprovalStepOut>;
  eligible_releasers: Array<string>;
  resolution_cases: Array<CaseSummary>;
  payment_summary: PaymentOut | null;
  anomaly: AnomalyOut | null;
  versions: Array<VersionOut>;
  evidence_refs: Array<Record<string, unknown>>;
}

export interface InvoiceListOut {
  items: Array<InvoiceSummary>;
  total: number;
  limit: number;
  offset: number;
}

export interface InvoiceSummary {
  id: string;
  invoice_number: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  version: number;
  row_version: number;
  kind: "invoice" | "credit_note";
  currency: string | null;
  amount_minor: number | null;
  amount_cad_minor: number | null;
  invoice_date: string | null;
  due_date: string | null;
  lifecycle_state: string;
  plain_status: string;
  risk_band: string | null;
  risk_score: string | null;
  blocking_findings_count: number;
  allowed_actions: Array<string>;
  blocked_reasons: Array<string>;
  source_kind: string;
  department_id: string | null;
  requester_id: string | null;
  owner: string | null;
  primary_action: PrimaryAction;
}

export interface LineOut {
  line_no: number;
  description: string;
  quantity: string;
  unit_price_minor: number | null;
  amount_minor: number | null;
  line_type: string | null;
  gl_account: string | null;
  gl_name: string | null;
  department_id: string | null;
  coding_confidence: string | null;
  coding_status: string | null;
  coding_method: string | null;
  alternatives: Array<Record<string, unknown>>;
  similar_lines: Array<Record<string, unknown>>;
}

export interface MeOut {
  user: UserOut;
  permissions: Array<string>;
  demo_notice?: string;
}

export interface OnboardRequest {
  legal_name: string;
  category?: string | null;
  country?: string;
  province?: string | null;
  gst_hst_number?: string | null;
  contact_email?: string | null;
}

export interface PaymentOut {
  id: string;
  invoice_id: string;
  invoice_version: number;
  method: string;
  route_id: string | null;
  currency: string;
  amount_minor: number;
  amount_cad_minor: number;
  state: string;
  simulation: boolean;
  label: string;
  source: string;
  prepared_by_id: string | null;
  released_by_id: string | null;
  reference: string | null;
  idempotency_key_hash: string | null;
  scheduled_date: string | null;
  created_at: string;
  released_at: string | null;
  settled_at: string | null;
}

export interface PrepareRequest {
  expected_version: number;
  invoice_id: string;
  method?: "EFT" | "CARD" | "CHEQUE" | null;
}

export interface PrimaryAction {
  kind: string;
  label: string;
}

export interface ReleaseOut {
  id: string;
  invoice_id: string;
  invoice_version: number;
  method: string;
  route_id: string | null;
  currency: string;
  amount_minor: number;
  amount_cad_minor: number;
  state: string;
  simulation: boolean;
  label: string;
  source: string;
  prepared_by_id: string | null;
  released_by_id: string | null;
  reference: string | null;
  idempotency_key_hash: string | null;
  scheduled_date: string | null;
  created_at: string;
  released_at: string | null;
  settled_at: string | null;
  idempotent_replay: boolean;
}

export interface ReleaseRequest {
  expected_invoice_version: number;
}

export interface RouteOut {
  id: string;
  method: string;
  account_masked: string | null;
  status: string;
  provenance: string;
  verified_at: string | null;
  bank_change_id: string | null;
}

export interface SettleRequest {
  outcome?: "SETTLED" | "FAILED";
}

export interface TaskOut {
  invoice: InvoiceSummary;
  plain_status: string;
  owner: string | null;
  primary_action: PrimaryAction;
}

export interface UploadOut {
  created: boolean;
  invoice: InvoiceSummary;
}

export interface UserOut {
  id: string;
  full_name: string;
  title: string;
  role: string;
  department_id: string | null;
  manager_id: string | null;
  status: string;
  status_since: string | null;
  delegate_user_id: string | null;
  approval_limit_minor: number;
  kind: string;
}

export interface VendorDetail {
  id: string;
  legal_name: string;
  category: string | null;
  status: string;
  country: string | null;
  province_or_state: string | null;
  requires_po: boolean;
  preferred_payment_method: string | null;
  accepts_card_payment: boolean;
  bank_account_masked: string | null;
  has_open_bank_change: boolean;
  source: string;
  gst_hst_number: string | null;
  payment_terms_days: number | null;
  contacts: Array<ContactOut>;
  bank_changes: Array<BankChangeOut>;
  routes: Array<RouteOut>;
  similar_identities: Array<Record<string, unknown>>;
  open_payable_minor: number;
  credit_balance_minor: number;
  contracts: Array<Record<string, unknown>>;
}

export interface VendorOut {
  id: string;
  legal_name: string;
  category: string | null;
  status: string;
  country: string | null;
  province_or_state: string | null;
  requires_po: boolean;
  preferred_payment_method: string | null;
  accepts_card_payment: boolean;
  bank_account_masked: string | null;
  has_open_bank_change: boolean;
  source: string;
}

export interface VerificationRequest {
  expected_row_version?: number | null;
  trusted_contact_id?: string | null;
  method:
    "phone_callback_to_contact_on_file" | "video_call_to_contact_on_file" | "in_person_meeting";
  occurred_at: string;
  outcome: "CONFIRMED" | "DENIED";
  notes: string;
  evidence_ref: string;
}

export interface VersionOut {
  version: number;
  created_at: string;
  created_by: string;
  reason: string;
  provenance: string;
  total_minor: number | null;
  currency: string | null;
}

export interface VersionedRequest {
  expected_version: number;
}

export interface WizardOut {
  current_step: "review" | "verify_supplier" | "choose_route" | "request_authorization" | "done";
  steps: Array<Record<string, unknown>>;
  route_options: Array<Record<string, unknown>>;
  failure_states: Array<string>;
  hold_active: boolean;
}

export interface WorkItemOut {
  id: string;
  email_id: string | null;
  item_type: string;
  status: string;
  note: string | null;
  subject: string | null;
  from_name: string | null;
  payable: boolean;
}
