# AHR-05 Distribution — integrated flow demo & contribution notes (DI-12 / SCRUM-110)

Contributor: **Khush Malawaliya** · Stage 1 **UC-05** · Epic **SCRUM-18**

This document demonstrates the AHR-05 Distribution flow end to end and records the contribution. The authoritative input/output contract is in [`docs/contracts/campaign-context.md` §7](./contracts/campaign-context.md); this is the walkthrough and evidence.

## The integrated flow

Distribution runs after AHR-04 approval and hands outcomes to AHR-06:

1. **Receive & verify (DI-03).** `verifyDistributionContext()` confirms the ad is AHR-04-approved, records the compliance approval id, and loads authorised channel access from the gateways. Missing context or an unavailable channel is refused with a reason and a founder notification — nothing is adapted or scheduled.
2. **Adapt per channel, claims frozen (DI-04).** `runMediaAdaptation()` builds one `ChannelVersion` per channel. The Media Manager's model writes a platform-native caption per channel (`decideChannelCaptions`), used only if it keeps every cleared claim and introduces none — otherwise the deterministic template stands (`AHR-05-R.claims-frozen`). Each adapted channel also gets a pasteable website embed (`embedHtml` = media + caption).
3. **Schedule & detect conflicts (DI-05).** `runSchedule()` / `detectScheduleConflicts()` propose posting times and flag `outside_window` / `same_slot` conflicts rather than silently moving or dropping them; unresolved conflicts hold the run for the founder.
4. **Publish, simulated (DI-06) via gateways (DI-02).** On the founder's `PUBLISH`, `runPublish()` releases each item through `selectGateway(item.channel).publish(...)` — a **digital** (social/web/email) or **physical** (print/in-store signage) gateway. No live platform client exists.
5. **Reliability (DI-07/DI-08/DI-09).** A submission is retried up to 3 times, never indefinitely; a late result is reconciled by stable `itemId` (no duplicate publish; an unknown/cancelled id is ignored, not invented); a channel that never confirms is recorded `failed` and escalated to the founder (`AHR-05-R.retry-cap`) — never skipped silently. Pause/resume is owned by the pipeline.
6. **Record outcomes & hand off (DI-10).** `deliveryReport` records per-channel attempts, retries, latency, confirmation refs and the run outcome (`complete | partial | none`). AHR-06 reads only channels that reached `published` with a `confirmationRef`; a withheld/unconfirmed channel stays a gap with its reason (never omitted — OD-2 agreed with the AHR-06 owner).

## Evidence — run the suite

```bash
npm run bench       # end-to-end scenario suite (no browser, no network)
npm run typecheck   # tsc --noEmit
```

Scenarios that exercise this flow (names as printed by `npm run bench`):

- *DI-02 — Media Manager agent generalizes Agent; digital/physical gateways registered & selected*
- *DI-03 — approved ad received, context verified (approval id + channel auth)*
- *AHR-05 — per-channel versions with frozen claims* (divergent-withheld channel)
- *AHR-05 — AI per-channel captions, guard-safe (claims-frozen)*
- *UC-05 ext 6.a — bounded retry + late-result reconciliation, then collect*
- *UC-05 ext 6.a — unconfirmed channel capped, escalated, never skipped silently*
- *DI-08 — pause respected; late result reconciled by id; duplicate & unknown handled*
- *DI-11 — publish-and-confirm latency recorded per item (late costs most)*
- *AHR-05 → AHR-06 — published, collected, gaps marked, decision stored*

Seeing it in the app: open a campaign → **Approve** → the **Schedule** tab shows per-channel captions and a *"Website embed"* block; the **Activity** tab shows the *"Per-channel captions"* AI step → **Publish** → the **Performance** tab collects results.

## Contribution notes

- **Code:** `src/lib/runtime/steps.ts` (`verifyDistributionContext`, `runMediaAdaptation`, `runSchedule`, `detectScheduleConflicts`, `runPublish`, `reconcileLateResult`), `src/lib/runtime/gateways.ts` (channel gateways), `src/lib/runtime/agents.ts` (`AIMediaManager`), `src/lib/runtime/decide.ts` (`decideChannelCaptions`), guard rule `AHR-05-R.retry-cap` in `guard.ts`, types in `runtime/types.ts` + `types.ts`.
- **Tests:** the AHR-05 / UC-05 scenarios in `scripts/bench-suite.ts`.
- **Docs:** input/output contract in `docs/contracts/campaign-context.md` §7 (reviewed by the AHR-01 and AHR-06 owners); this demo.
- **Tickets:** DI-01…DI-12 under SCRUM-18 (SCRUM-99…110).
- **Simulated by design:** there is no live platform client or paid LLM call in the test runs; publishing is simulated through the gateways and captions fall back to a deterministic template when no model is configured (the suite proves the model path with a scripted model).

AI assistance (Claude) was used while implementing this section; design, integration and testing were reviewed by the contributor.
