# Acceptance tests AT-01 … AT-48 — backend coverage

Status legend: **PASS** = executable backend test passes (`.venv/bin/python -m pytest`, 103 passed on
2026-11-21). **BACKEND PASS / UI PENDING** = backend contract tested; the UI half belongs to the
frontend owner. **PARTIAL** / **DEFERRED** = stated reason. Test files are under `backend/tests/`.

| ID | Scenario | Status | Test(s) |
|---|---|---|---|
| AT-01 | French / scanned invoice | PASS (scans read by local OCR, provenance `ocr`; unseen PNG/JPEG/image-PDF uploads OCR'd) | test_dataset_fixtures::test_at01_…, test_ocr::test_dataset_scans_are_ocrd_and_match_transcriptions, test_ocr::test_unseen_scan_upload_runs_real_ocr |
| AT-02 | Email without attachment | PASS | test_dataset_fixtures::test_at02_at24_non_payable_and_missing_document |
| AT-03 | Unknown supplier | PASS | test_dataset_fixtures::test_at03_unknown_vendor_held |
| AT-04 | Contract overcharge / fuel cap | PASS | test_at04_fuel_surcharge_cap |
| AT-05 | Wrong provincial tax | PASS | test_at05_wrong_provincial_tax |
| AT-06 | Reformatted duplicate number | PASS | test_at06_reformatted_duplicate_numbers |
| AT-07 | Previously paid via Brim card | PASS | test_at07_card_paid_duplicate |
| AT-08 | Requester tries to approve | PASS (403 + DENIED audit) | test_workflow::test_at08_requester_self_approval_denied_and_audited |
| AT-09 | Approver tries to release | PASS | test_at09_at17_approver_cannot_release_controller_or_cfo_does |
| AT-10 | Approved amount edited | PASS | test_at10_amount_edit_invalidates_approvals |
| AT-11 | Unverified bank change | PASS | test_at11_bank_change_hold_despite_matching_master, test_bank_change_wizard_full_journey |
| AT-12 | Simulated verified card route | PASS: card acceptance + independently verified card route + finance-manager method-change authorization (SoD) + approvals + independent release; method-change parties cannot release; material edit supersedes | test_card_reroute::test_full_eft_to_card_reroute_with_segregation_of_duties, test_card_route_registration_and_independent_verification, test_material_edit_supersedes_…, test_workflow::test_at12_at44_… |
| AT-13 | Double-click release | PASS (+ concurrent threads) | test_happy_path_…, test_concurrent_release_creates_one_payment |
| AT-14 | Auditor reviews settled invoice | PASS (flight recorder + CSV + hash chain) | test_happy_path_vertical_slice_and_idempotent_release |
| AT-15 | Unknown / unreadable field | PASS (incl. low-confidence OCR values left UNKNOWN → EXTRACTION_INCOMPLETE) | test_upload_pipeline_and_safety, test_ocr::test_low_confidence_* , test_ocr::test_blank_scan_needs_manual_extraction |
| AT-16 | Direct URL/API access | PASS | test_at16_scope_and_identity, test_demo_mode_off_rejects_identity_header |
| AT-17 | > CAD 10k release | PASS | test_at09_at17_…, test_policy::test_edge1_… |
| AT-18 | > CAD 250k | PASS | test_at18_over_250k_no_eligible_releaser, test_policy::test_edge2_… |
| AT-19 | Facilities > 10k, U012 on leave | PASS (live on Queen Street 002935) | test_at19_queen_street_facilities_delegate_collision, test_policy::test_edge3_… |
| AT-20 | Legal > 10k | PASS (Harlow & Stern 001468) | test_at20_legal_vendor_fm_once_with_p02_p06, test_policy::test_edge5_… |
| AT-21 | Vendor requires PO, none | PASS | test_at21_p13_missing_po_hold |
| AT-22 | Credit note | PASS | test_at22_credit_note |
| AT-23 | USD invoice | PASS | test_at23_usd_invoice_date_fx, test_unknown_fx_rate_holds |
| AT-24 | Statement / inquiry / marketing | PASS | test_at02_at24_… |
| AT-25 | Investigation of Cascadia 1625 | PASS (deterministic template; AI off) | test_investigation::test_at25_… |
| AT-26 | SQL / write in agent query | PASS — v1.4 A3: no SQL tool exists; unknown tools and malformed IDs rejected | test_at26_at47_…, test_tool_rejects_unknown_tool_sql_and_out_of_scope |
| AT-27 | 8-call cap | PASS | test_at27_call_budget_marks_incomplete |
| AT-28 | Unsupported number | PASS | test_at28_unsupported_number_rejected |
| AT-29 | "approve this invoice" in text | PASS | test_units::test_injection_text_is_detected_as_data, test_workflow::test_at29_… |
| AT-30 | Model unavailable | PASS | test_at25_… (source = deterministic_template) |
| AT-31 | Lookups in Flight Recorder | PASS | test_at31_lookups_in_flight_recorder |
| AT-32 | Lattice Ledger 557 | PASS (6.4× usual CAD 1,437.83; range 1,386.00–1,491.60 over 8 invoices — computed, see note) | test_at32_lattice_unusual_amount_from_code |
| AT-33 | Queen Street fixed rent | PASS (score 0) | test_at33_queen_street_fixed_rent_not_unusual |
| AT-34 | Credit note not amount-scored | PASS | test_at22_credit_note, test_units::test_anomaly_… |
| AT-35 | Scanned Cascadia 1624 | PASS (OCR'd; hard hold from BC-009 even though dated before it; anomaly identity signal BC-009) | test_at35_scanned_cascadia_before_change_still_held, test_anomaly::test_at35_… |
| AT-36 | Backtest AP-00173, no look-ahead | PASS (as-of bank-change and amount inputs; planted future invoices never change a backtest score) | test_anomaly::test_at36_…, test_future_invoices_never_change_a_backtest_score, test_bank_change_requested_after_as_of_is_invisible |
| AT-37 | Correlated identity signals counted once | PASS (grouped noisy-OR keeps the strongest identity signal) | test_anomaly::test_at37_correlated_identity_signals_count_once, evaluate_anomaly `at37_correlated_identity_counted_once` |
| AT-38 | Same inputs twice | PASS | test_at38_revalidation_is_deterministic, test_units::test_anomaly_… |
| AT-39 | Injection catch-rate experiment | PASS (fixed seed; per-type catch rate + false-alarm rate on the unmodified sample; stored with method version — `docs/eval/anomaly_eval.json`) | test_anomaly::test_at38_at39_evaluation_is_reproducible |
| AT-40 | Role-scoped Home | BACKEND PASS / UI PENDING | test_dashboard_role_scoped_one_action_per_task |
| AT-41 | Non-technical review | BACKEND PASS / UI PENDING (plain_status, why_it_matters, next_action, one primary_action) | covered by dataset/workflow tests |
| AT-42 | Wizard: no callback evidence | BACKEND PASS / UI PENDING | test_bank_change_wizard_full_journey |
| AT-43 | Wizard: authorized verification | BACKEND PASS / UI PENDING | test_bank_change_wizard_full_journey |
| AT-44 | Wizard: card route missing | BACKEND PASS / UI PENDING | test_bank_change_wizard_full_journey, test_at12_at44_… |
| AT-45 | Wizard: request authorization | BACKEND PASS / UI PENDING | test_bank_change_wizard_full_journey, test_at45_… |
| AT-46 | Flight Recorder persisted vs proposed | BACKEND PASS / UI PENDING | test_at46_flight_recorder_distinguishes_proposed |
| AT-47 | No SQL/write/approval/release tool | PASS | test_at26_at47_…, test_service_identity_has_no_financial_authority |
| AT-48 | Risk explanation, sparse history | PASS (amount component says "limited supplier history"; identity signals shown separately) | test_at32_…, test_at48_sparse_history_shows_uncertainty |

Note on AT-32: the PRD quotes "usual $1,439". Sentinel reports the exponentiated median of log
amounts (CAD 1,437.83) computed from 8 prior invoices; the range and 6.4× ratio match the PRD.

Additional controls beyond AT-01…AT-48 (all PASS): split billing (`test_card_reroute::test_split_billing_held_for_finance_review`),
maker-checker on manual versions, rate limiting, security headers, CSV formula neutralization, LIKE escaping,
terminated identities, bounded uploads, bank-detail formats (`tests/test_security.py`), OCR provenance and
fallbacks (`tests/test_ocr.py`).
