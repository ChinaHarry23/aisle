<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Team tutorial preference (requested by Danting)
For similar agent/data-retrieval work, follow the applicable methods documented in
`docs/TEAM-TUTORIAL-METHODS.md`: typed tool/schema discovery, model routing, validated
execution, result feedback, grounded analysis, bounded calls and reproducible tests.
Do not copy tutorial mock data into live evidence or introduce Fabric/KQL unless
that data platform is actually required. Preserve the existing shared runtime.
Danting authorised committing and pushing the reviewed TA-03 branch on 21 October 2026.
Do not merge or deploy without a separate request. TA-01 and TA-02 Jira issues stay unchanged.
