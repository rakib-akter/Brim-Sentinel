# Demo extraction fixtures (`provenance = demo_fixture`)

No OCR engine (Tesseract) or AI vision is available in this environment, and `AI_ENABLED=false`
by default. The two scanned PNG invoices in the dataset therefore have **hand transcriptions**
stored here in the same plain-text layout the PDF text layer produces. They are processed by
the same parser and every resulting field is labelled `demo_fixture` — never `ocr`.

Unseen scanned uploads without a fixture are routed to `NEEDS_MANUAL_EXTRACTION`
(finding `EXTRACTION_INCOMPLETE`, payment held) for clerk entry via
`PATCH /api/v1/invoices/{id}/fields` (provenance `manual`).
