# Team tutorial methods

Danting requested on 20 October 2026 that similar future work follow Cindy's
[developer tutorial](https://github.com/CindyU-beep/chat-with-your-data/blob/main/developer-guide/tutorial.ipynb)
where applicable. Read the complete notebook including its advanced tool-calling section.

## Apply to Aisle

1. Discover available schemas/capabilities before constructing a query. Our Zod
   registry declares tool arguments; ABS discovery supplies actual dimension order
   and code labels instead of letting the model invent a dataset key.
2. Let the model route an approved question to named tools. The application validates
   and executes arguments, then returns tool results paired with their call IDs.
   A second model turn analyses the actual records. Reuse the existing shared
   LangChain / MeteredChatModel transport and billing identity.
3. Separate collection, parsing/normalisation, evidence records and analysis.
   Keep URLs, dates, units, geography and transformations attached to observations.
4. Keep credentials server-side; bound model turns, tool calls, token allowance,
   data size and external-service costs. Cache duplicate requests within one run
   and report errors without converting them to invented data.
5. Test multiple contexts and mixed tool requests. Store explicit mock traces
   separately from live public-provider results. Show gaps in the UI.

## Adapt rather than copy

The notebook uses Python, Azure OpenAI, Fabric/Kusto and Pandas. Aisle already uses
TypeScript, Next.js and shared adapters; no Fabric account/database requirement has
been established. Do not add that infrastructure merely to copy the example.
The tutorial weather function returns hard-coded **mock** data. Never promote those
values into live evidence. Weather (including historical weather) is optional for
weather-sensitive retail questions, not a required substitute for market research.
The notebook's basic query execution is a teaching example: production queries
need validation and least privilege. Its tool-calling demonstration is not copied
literally; the existing framework pairs one assistant message with all its results.
Do not print secrets or send raw private retailer/customer records to public tools.

Future maintainers: consult this file for related agent/data tasks and record any
necessary deviations. User instructions and the approved project scope take priority.

21 October refinement: Danting requires one actual tool request per mandatory
research category (and selected channel). The application now schedules a guarded
mandatory collection pass before model-selected enrichment. Results are supplied
to the model for analysis. This intentional coverage guarantee overrides purely
optional model routing; no unrelated source can fill a missing category.
