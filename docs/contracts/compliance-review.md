# CC-01 / CC-02 — Compliance Review contract (Chester)

Status: implemented proposal; AHR-03 and AHR-05 owner review is pending.
Baseline: origin/main ea7b3a2 (LangGraph operation). This document does not claim team approval.

## Scope and traceability

| Requirement | Current behaviour / evidence | Remaining work |
| --- | --- | --- |
| CC-01 / UC-04 submission inputs | `submissionSchema` in `src/lib/compliance/service.ts` validates the fields below; JSON examples included | AHR-03 owner agreement; per-selected-ad vs batch decision |
| CC-01 output contract | `ComplianceReviewRun.result` retains status, structured findings, rejection reason, limitations and report reference; identity/attempt on run | Full report resolution semantics CC-05 |
| CC-02 authorised submission | LangGraph compliance.receive invokes receiveComplianceSubmission; running pipeline and unpublished draft required | Shared gateway authentication remains owned by platform |
| CC-02 run creation | Review ID, content/context identity, pipeline ID, start time, status, attempt and copied submission recorded before provider call | End-to-end crash recovery and concurrent deduplication CC-09 |
| CC-02 invalid input | INVALID_SUBMISSION, REVIEW_NOT_AUTHORISED, VERSION_MISMATCH; invalid receive halts with a structured audit event | Public dedicated submission API not added |
| CC-02 unpublished / no autonomous approval | Service has no approval, publishing or distribution operation; review delegates to existing decision adapter and human gate | Harden version-specific final human decisions CC-08 |
| CC-03 rules | Existing country text, brand terms and uploaded guidelines copied into submission | Authorised source registry, versions, expiry/conflicts and escalation |
| CC-04 checks | The compliance agent returns the findings. Code does not scan prices, phrases, images or claims, and it does not pass an advertisement on its own | Agent review only; output-format and policy-presence guard rails |
| CC-05 report | Existing findings have severity, basis, excerpt, explanation, rule and correction | Existing medium/judgement-to-pass behaviour remains; unresolved finding model needed |
| CC-06 revision | Existing corrective loop retained; submitted content now retained in review snapshots | Generation-owned immutable version history and current-version reference |
| CC-07 limits | Existing three-total-review limit unchanged | Correct to initial review plus three revised drafts |
| CC-08 human approval | Existing gate remains | Manager identity, exact-version approval, durable approval before handoff |
| CC-09 lifecycle | Receipt is a separate checkpoint; duplicate receipt in one snapshot reuses ID | Cross-request concurrency, cancellation/late-result reconciliation, durable inline mode |

## Function boundary and ownership

AHR-03/orchestrator -> `submissionFor(campaign, brand)` -> `beginReview(campaign, brand, submission, now)`.

Only the shared workflow calls this internal server function. There is no new unauthenticated HTTP endpoint. `beginReview` checks execution eligibility, not login credentials: the existing authenticated API and workflow repository supply authority. Do not expose it directly to clients or treat a caller-supplied `running` flag as authentication. The existing inline engine still accepts browser campaign snapshots; strengthening that boundary is shared-platform work.

The receipt step appends `campaign.complianceReviewRuns`, sets `compliance.review`, and returns without a model call. In service mode the worker runs one step at a time and `WorkflowRepository.checkpoint` saves the campaign before the next step. A failed checkpoint cannot proceed to the review call. Next, `runComplianceReview` requires a matching UNDER_REVIEW record, invokes the existing `decideCompliance` / `LlmRuntime.request` adapter, and attaches the result/report reference.

The review service does not own SQL connections. The orchestrator/repository owns persistence; workspace snapshots retain the new optional field. Inline mode is backward compatible but still depends on client workspace saving and does not guarantee a durable pre-call write. Use service mode for the checkpoint guarantee. A provider exception leaves the previously stored receipt pending; full recovery is CC-09.

## Input contract (v1)

See `examples/compliance-valid.json` and `examples/compliance-invalid.json`.

- campaignId: existing campaign identity.
- advertisementVersionId: `adv_` plus SHA-256 of the ordered validated submission context (excluding this ID). Adapter computes it; service verifies the entire parsed payload against current data.
- version: positive integer. All submitted A/B variants currently share it; individual creative IDs must be unique.
- content: non-empty list with creativeId, headline, body, caption, callToAction, imageUrl (nullable), creation timestamp and generation prompt. Null image means unavailable, not verified image compliance.
- productInformation, campaignObjective, targetAudience: non-empty strings.
- brandAssets: retailer name, optional logo represented by null, guideline text, banned/approved terms and country rule text. Empty guideline list is explicit absence, not proof of policy completeness.
- country: AU/NZ/UK/US; targetPlatforms: non-empty supported channel list.
- limitations: explicit unknowns. New workflow creatives record creation time; legacy drafts use campaign creation time with a limitation, never claim this is the known generation timestamp.

Version identity covers content, generation inputs, country/platform/audience and brand-policy context. This is a review-snapshot identity, not a substitute for the future AHR-03 AdvertisementVersion database identity. Same number with changed text or context is a different submission. Image URLs are recorded; binary asset hashing and provenance remain future work. Uploaded guidelines retain only extracted text in the existing app.

## Run and output

`ComplianceReviewRun`: reviewId, campaignId, advertisementVersionId, pipelineRunId, status (UNDER_REVIEW / COMPLETED), startedAt, completedAt, attemptNumber, submission, result.

`result.status` uses existing names: pass, changes_required, manual_review. A pass means automated review output only, never human APPROVED. Findings reuse ComplianceIssue: id, category, basis (confirmed_breach / human_judgement), severity, excerpt (affected content), explanation, rule, policySource, policyDate, recommendedCorrection. Result includes rejectionReason, limitations and reportId. Counts/status correctness beyond receipt are CC-05/07.

A repeated identical registration in the same pipeline reuses its review ID and attempt number. Attempts continue from legacy attempts/new run records. No limit changes in CC-02. Prior snapshots are retained when later drafts arrive.

## Errors

`ComplianceSubmissionError.toJSON()` returns:

```json
{"code":"INVALID_SUBMISSION","message":"Compliance submission is incomplete or invalid.","fields":[{"field":"content","message":"Too small: expected array to have >=1 items"}]}
```

Codes: INVALID_SUBMISSION (field validation / empty or mixed versions), REVIEW_NOT_AUTHORISED (wrong execution stage or non-draft status), VERSION_MISMATCH (stale/tampered input or missing active run). Field messages come from schema validation; consumers should branch on code/field, not wording. The receipt handler writes the structured error into campaign audit history and halts; it never calls the provider on rejection.

## Proposed decisions — owner review required

| Decision | Proposal | Required reviewer / status |
| --- | --- | --- |
| Batch vs selected ad | Preserve current A/B batch with shared version; split later if AHR-03 selects one | Cindy / pending |
| Version identity | Hash review snapshot now; accept immutable generation ID when CG-04 provides it | Cindy + platform / pending |
| Submission confirmation | Shared orchestrator must eventually enforce exact-version founder confirmation; current generator auto-submits | Cindy + platform / pending |
| Storage responsibility | Repository checkpoints campaign; service-mode required for durable pre-call receipt | Harry / pending |
| AHR-05 output | Consume only explicit human-approved version, not result.status=pass | Distribution owner / pending |

No Jira comments have been posted and no owner approval has been assumed. Copy these unresolved decisions to the corresponding Jira issues during team review. CC-01 cannot be marked fully Done until the owner-review acceptance criterion is satisfied.

## Verification

`npm run test:compliance`: required/malformed input, duplicate IDs, exact snapshot identity, duplicate receipt, permissions, LangGraph receipt checkpoint, provider failure, rejected submission and no autonomous approval/distribution. `npm run bench` retains existing end-to-end regression behaviour; it is not proof of full CC-03 through CC-09 compliance.

## CC-03 / CC-04 implementation update

`rules.ts` uses the reviewed official-source starter registry in `src/lib/compliance/policies/official-rules.json`, or an explicitly configured server-owned JSON override from `AISLE_COMPLIANCE_RULES_FILE`. Its shape is `{authorisedSources: string[], rules: ComplianceRule[]}`; see `ruleSchema` for all required fields. A maintainer must keep sources and versions current; client-uploaded text cannot authorise registry sources. Selection checks source allow-list, dates, conflicts, country, platforms, audience and product/objective scope. Rules for the campaign jurisdiction and global (`*`) rules are binding review inputs. Only when a local advertising-law or consumer-protection category is missing are valid rules from other jurisdictions retained as clearly labelled, non-binding reference context; they cannot establish a breach or a pass. Missing binding coverage safely produces manual review. The binding and reference snapshots are retained before model invocation.

`checks.ts` does not scan the advertisement. Phrase, price, image and claim matches are not findings and cannot force a pass. The compliance agent's structured JSON is the review. Code only refuses to pass that answer when it is missing, inconsistent, the authorised policy registry is absent, or the revision cap is spent. Those are output and process guard rails. They do not read the advertisement text. Image pixel analysis and independent price or licence verification are not claimed. Missing policy stops a pass. A pass still is not human approval.

Verification: `npm run test:compliance-rules` uses clearly synthetic test policies. Production policy curation is still required before a trustworthy automatic pass is possible. CC-05 report presentation and unresolved-finding consistency follow in a separate change. Full approval enforcement remains CC-08; the legacy human approval route must not be interpreted as automated policy clearance.

## CC-05 implementation update (uncommitted work)

`report.ts` builds an immutable structured report linked to review ID and exact submission identity. It records generation time, attempt number, every finding, severity, basis, affected content, supporting rule/source, correction, unresolved counts, policy problems and limitations. All newly generated findings are unresolved: low/medium violations cannot pass. Human-judgement findings or policy problems require manual review. The legacy report adapter now correctly maps manual_review to escalate rather than pass. Existing revision-limit escalation is preserved pending CC-07.

Campaign -> Compliance and the Approvals queue reuse `ComplianceReviewHistory` inside `ChecksPanel`: newest review expanded, previous reports expandable, pending receipt visible, exact submitted text, rule versions and limitations available. Existing pre-CC-05 reviews remain visible without inventing structured reports for them. The legacy summary no longer counts the same finding from both report and attempt lists. These displays do not introduce a new human-resolution/approval mechanism (CC-08).

Run `npm run test:compliance-report`. A real-policy registry is still a deployment prerequisite; absent configuration is deliberately visible as manual review, not an implicit pass.
