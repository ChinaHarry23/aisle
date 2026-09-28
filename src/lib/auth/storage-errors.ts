/**
 * What the founder sees when storage is not usable.
 *
 * The old signup route put the raw driver message on the form, which is how
 * "Vercel Blob: Failed to fetch blob: 403 Forbidden" ended up in front of a user
 * who only wanted an account. A storage fault is an operator problem, so the
 * person signing up gets a sentence they can act on, and the detail goes to the
 * server log where an operator can see it.
 */

import { isDatabaseUnavailable } from "@/lib/db";

export const STORAGE_MESSAGE =
  "This desk could not reach its database, so the account was not created. Nothing was lost — try again in a moment.";

export type StorageFailure = {
  /** True when the request failed because storage is unusable. */
  unavailable: boolean;
  /** Safe to show a user verbatim. */
  message: string;
  /** Full detail, for the server log only. */
  detail: string;
};

export function describeStorageFailure(error: unknown, context: string): StorageFailure {
  if (isDatabaseUnavailable(error)) {
    return {
      unavailable: true,
      message: STORAGE_MESSAGE,
      detail: `${context}: ${error.message}`,
    };
  }
  return {
    unavailable: false,
    message: error instanceof Error ? error.message : "Something went wrong.",
    detail: `${context}: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
  };
}
