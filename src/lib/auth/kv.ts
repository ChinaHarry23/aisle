/**
 * Workspace and inbox documents.
 *
 * This module used to be the Vercel Blob client: every read and save was a network
 * call authenticated by `BLOB_READ_WRITE_TOKEN`. When that token stopped working,
 * signup failed outright and every page save quietly failed with it. Storage is
 * now rows in the database (see `@/lib/db/kv`), behind the same two functions, so
 * the rest of the app was unchanged and there is one fewer credential to get
 * wrong.
 *
 * `kvGet` / `kvSet` remain the application's only storage seam.
 */

export { kvGet, kvSet, kvDelete, kvKeys } from "@/lib/db/kv";
