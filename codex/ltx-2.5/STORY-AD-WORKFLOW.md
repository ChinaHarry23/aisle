# Default 30 Second Campaign Story Ad

Studio and Settings now offer **30s complete story ad** separately from 5–15s test clips. New local workspaces default to 30s; the current signed-in Orchy workspace was explicitly set to LTX-2.5 / 30s through the UI and verified after a reload. Existing media is retained.

The campaign's selected creative provides the existing closing headline and CTA. The server builds three fresh narrative scenes: 0–10s everyday setup, 10–20s product interaction/reaction, and 20–26s product hero. A deterministic 26–30s closing card adds the product name and campaign copy without relying on diffusion-generated lettering. No new offers or benefits are invented by the planner. Prompts specify photographic materials, consistent subject/wardrobe, lighting, plausible actions and explicit cuts. Cross-generation identity and real packaging still require visual review; text prompts do not guarantee identity consistency.

## Starting the Local Services

`npm run dev:services` now starts the web app, workflow API, agent worker and local media-production worker together. `npm run media:worker` is available for a separately managed worker, provided it receives the same workflow URL/secret and database configuration as the web app. Do not print service secrets.

Clicking **Generate 30s story ad** enqueues a private durable job and returns HTTP 202 promptly. The worker runs scenes sequentially, saves every submitted backend ID and completed scene, edits and verifies a 30.00s / 720-frame / 24fps MP4, stores the result in the owner-checked media store, attaches it to the authoritative campaign, and reopens the campaign before reporting completion. It does not approve, schedule or publish. Local LTX does not use the poster as input. MiniMax retains its generated-poster requirement and image provenance. Cloud model clip limits/billing are unchanged; no paid fallback occurs for a story production.

Full HD is the default LTX quality, with HD preview selectable. 30s is **not** passed to the single-clip renderer: each scene request remains within 5–15s. This installed BF16 Mac runtime must keep `--use-split-cross-attention`; the existing 5s 720p take is live-verified, but a complete new 30s LTX ad / Full-HD render has not been produced by this implementation task.

## Progress and Recovery

The webpage reports scene number, confirmed sampler steps, editing, saving and completion. Navigation/reload does not own or cancel the background job. Queued jobs receive worker heartbeats, terminal results cannot be erased by late events, and a backend-completed scene is not treated as an attached final ad. Production timing and per-scene timing remain visible with completion dates in Sydney time.

Local worker logs print scene labels and backend job IDs. Durable queue: `data/media-productions.db`. Retained artifacts: `data/media-productions/<production-id>/` (storyboard, requests, scene files/results, end-card, finished file, probe metadata, contact sheet). If the worker loses its lease or a scene fails, it stops without automatically resubmitting a potentially still-running GPU job. Inspect recorded backend IDs and retained files before attempting recovery. Approval/state/source changes block remaining scenes and final attachment.

`npm run test:story-ad` uses isolated temporary databases and obviously synthetic test footage, never the user's campaign. It tests defaults, model clip limits, source/approval guards, tenant isolation, queue reopening, duplicate claims, black/short video rejection, real editing to exactly 30s/720 frames, persistence/reopen, and partial output retention. These tests validate the pipeline, not the visual quality of a new LTX ad.

Sources: [LTX official prompting guide](https://docs.ltx.io/api-documentation/implementation-guides/prompting-guide), [official ComfyUI LTX-2.5 workflows](https://docs.comfy.org/tutorials/video/ltx/ltx-2-5), [FFmpeg filters](https://ffmpeg.org/ffmpeg-filters.html).
