# Uploaded-document compliance review

Policy files are uploaded and managed in `/approvals`. They are consumed automatically when a campaign moves from Content Generation to Compliance Checker; there is no standalone paste-and-check panel or separate review API.

## Use

1. Upload a law or policy file in Approvals. Scanned PDFs need OCR before upload.
2. Launch a campaign. Content Generation stores each variant's text, image URL and generation prompt.
3. The pipeline creates an exact, hashed compliance submission containing those creatives, campaign context and document snapshots.
4. Compliance Checker merges deterministic checks, authorised rules, uploaded-document comparison and multimodal text/image review.
5. Confirmed breaches return to Content Generation for revision, up to three attempts. Uncertain coverage and human-judgement findings go to Approvals.
6. The Compliance Checker page shows the submitted advertisement beside findings, citations, improvements and checks with no issue found.

## Behaviour and limits

- Reports are retained on the campaign against an exact advertisement version ID; a changed creative cannot reuse an earlier review.
- A clean outcome means no issue identified within configured checks and supplied sources, not complete legal clearance.
- Uploaded document sets over 60,000 characters are not silently truncated by the comparison step; unavailable coverage becomes a human-review finding.
- Document quotations are verified against the saved source and advertisement snapshots. Applicability, currency and uncertain interpretations still require human judgement.
- Poster image URLs are also sent to the configured multimodal Compliance model. If that review cannot complete, the campaign records a coverage finding instead of passing silently.
- Uploaded material does not become an authorised law source merely because it was uploaded. Server-controlled rule authorisation remains separate.

## Verification

`npm run test:document-review` checks exact citations, malformed results, uncertainty, truncation, review limits and the combined document-plus-multimodal campaign path using injected model fixtures.
