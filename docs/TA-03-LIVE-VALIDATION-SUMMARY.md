# TA-03 real validation — 23 October 2026

Both final real scenarios pass all seven automatic assertions in `scripts/trend-research-acceptance.ts`: every area attempted, every area assessed, two model-selected external tool types, citations from both types, valid tool arguments, honest safe partial result and the actual selected model. The normal no-credentials path is separately tested without I/O or spend.

| Scenario | Channel | Candidate records | Areas assessed | Model turns | Estimated inference/tool spend USD |
| --- | --- | ---: | ---: | ---: | ---: |
| Apple juice / Grocery / AU | web | 51 | 8 / 8 | 2 | 0.40113 |
| Rain jacket / Apparel / AU | email | 63 | 8 / 8 | 2 | 0.40115 |

Each model independently selected original-page extraction and public-holiday lookup, inspected returned data, and cited both tool types. Products, channel queries and selected source URLs differ. Calendar facts are not represented as proof of cultural purchasing preference. Candidate counts do not establish factual adequacy: unsupported categories retain explicit limitations and the reports stay PARTIAL with no creative handoff.

The root defect was Zod objects being spread into tool parameters instead of converted to JSON Schema. This lost argument names/enums, causing model calls to fail framework validation. The repair preserves schemas on the wire, pairs provider-safe tool names across turns, bounds result feedback and separates collection from final assessment. Regression tests check the actual outgoing schema, not only registry names.

The conservative model token envelope is now 48,000 including the next request/output reservation; maximum output is 4,000 tokens per turn. Tool and model-call/time/cost caps still apply. Unvalidated findings no longer inherit legacy confidence percentages.

Only model credentials from the team's file are used locally and remain ignored. Firecrawl/SerpApi/WhichGrocer credentials are absent; their typed adapters have fixture coverage and fail explicitly when unavailable. ABS non-production/unverified series are rejected. Public-source alternatives work without pretending specialist measurements were retrieved. No API keys, deployment credentials or detailed third-party excerpts are committed.

Published evidence: `docs/TA-03-ACCEPTANCE-SUMMARY.json`. Full live transcripts and earlier failed attempts remain local and ignored. Reference for web search/domain filters: https://developers.openai.com/api/docs/guides/tools-web-search
