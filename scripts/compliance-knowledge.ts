import { readFileSync } from "node:fs";
import { z } from "zod";
import { KnowledgeStore } from "../src/lib/compliance/knowledge/store";
const [command, ...args] = process.argv.slice(2);
const store = new KnowledgeStore();
try {
  if (command === "list") console.log(JSON.stringify(store.list(), null, 2));
  else {
    const config = process.env.AISLE_COMPLIANCE_KB_SOURCES_FILE;
    if (!config) throw new Error("Set AISLE_COMPLIANCE_KB_SOURCES_FILE to a maintainer-owned source allow-list JSON file.");
    const { authorisedSources } = z.object({ authorisedSources: z.array(z.url()) }).parse(JSON.parse(readFileSync(config, "utf8")));
    if (command === "ingest" && args.length === 2) console.log(JSON.stringify(await store.ingest(args[0], JSON.parse(readFileSync(args[1], "utf8")), authorisedSources), null, 2));
    else if (command === "search" && args.length >= 2) console.log(JSON.stringify(store.search(args[1], { jurisdiction: args[0], platform: args[2], authorisedSources }), null, 2));
    else throw new Error('Usage: npm run compliance:kb -- list | ingest <document> <metadata.json> | search <country> "<query>" [platform]');
  }
} catch (error) { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; }
finally { store.close(); }
