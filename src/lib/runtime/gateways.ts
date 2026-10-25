/**
 * AHR-05 distribution channel gateways (DI-02 / SCRUM-100).
 *
 * The Media Manager never talks to a live platform. Instead each selected channel
 * is served by a `DistributionChannelGateway` — a **digital** one (social, web,
 * email) and a **physical** one (print, in-store signage) — chosen by channel
 * type. The release is **simulated**: `publish()` models the submission lifecycle
 * (bounded retries, late-result reconciliation per UC-05 ext 6.a) and returns a
 * `DeliveryAttempt`. No live platform client exists; adding one later means
 * implementing this same interface for a real transport.
 */

import type { Channel } from "@/lib/types";
import { MAX_PUBLISH_RETRIES, type DeliveryAttempt, type DeliveryOutcome } from "./types";

type ChannelType = "digital" | "physical";

/** Creative format families a gateway can carry. */
type ChannelFormat = "image" | "html" | "text" | "print" | "signage";

type PublishItem = { id: string; channel: Channel };

interface DistributionChannelGateway {
  readonly name: string;
  /** "digital" (social/web/email) or "physical" (print/in-store signage). */
  getChannelType(channel: Channel): ChannelType;
  /** Whether this gateway can carry the given creative format on the channel. */
  supportsFormat(channel: Channel, format: ChannelFormat): boolean;
  /** Whether the (simulated) channel endpoint is reachable. */
  isAvailable(channel: Channel): boolean;
  /** Simulate one submission and return the per-item delivery record. */
  publish(item: PublishItem, outcome: DeliveryOutcome, now: string): DeliveryAttempt;
}

/** Deterministic 0–99,999 string hash. Used for simulated gateway refs here and for channel-metric seeds in steps.ts collectChannelResults. */
export function stableHash(text: string) {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) % 100_000;
  return h;
}

/**
 * The shared simulated-delivery lifecycle (UC-05 ext 6.a), used by every gateway:
 * one initial send plus up to `MAX_PUBLISH_RETRIES` retries, with a late result
 * reconciled to the same item id rather than resubmitted.
 */
function simulate(
  item: PublishItem,
  outcome: DeliveryOutcome,
  now: string,
  via: string,
): DeliveryAttempt {
  const ref = `${item.channel}-${stableHash(item.id).toString(36)}`;
  const base = { itemId: item.id, channel: item.channel, at: now };
  const cappedAttempts = 1 + MAX_PUBLISH_RETRIES;
  switch (outcome) {
    case "retry_then_ok":
      return {
        ...base,
        attempts: 2,
        retries: 1,
        status: "published",
        confirmationRef: ref,
        reconciled: false,
        note: `Initial send timed out; confirmed on retry 1 of ${MAX_PUBLISH_RETRIES} via the ${via} gateway (ref ${ref}).`,
      };
    case "fail":
      return {
        ...base,
        attempts: cappedAttempts,
        retries: MAX_PUBLISH_RETRIES,
        status: "failed",
        confirmationRef: null,
        reconciled: false,
        note: `No confirmation from the ${via} gateway after the initial send and ${MAX_PUBLISH_RETRIES} retries. Not retried further and not skipped silently — raised for the founder.`,
      };
    case "late":
      return {
        ...base,
        attempts: cappedAttempts,
        retries: MAX_PUBLISH_RETRIES,
        status: "published",
        confirmationRef: ref,
        reconciled: true,
        note: `Initial send and ${MAX_PUBLISH_RETRIES} retries timed out; a late confirmation (ref ${ref}) from the ${via} gateway was matched to this item id and reconciled, not resubmitted.`,
      };
    case "ok":
    default:
      return {
        ...base,
        attempts: 1,
        retries: 0,
        status: "published",
        confirmationRef: ref,
        reconciled: false,
        note: `Confirmed on the first submission via the ${via} gateway (ref ${ref}).`,
      };
  }
}

/** Social, web and email. */
const digitalGateway: DistributionChannelGateway = {
  name: "Digital (social, web, email) — simulated",
  getChannelType: () => "digital",
  supportsFormat: (_channel, format) =>
    format === "image" || format === "html" || format === "text",
  isAvailable: () => true,
  publish: (item, outcome, now) => simulate(item, outcome, now, "digital"),
};

/** Print and in-store digital signage. */
const physicalGateway: DistributionChannelGateway = {
  name: "Physical (print, in-store signage) — simulated",
  getChannelType: () => "physical",
  supportsFormat: (_channel, format) =>
    format === "print" || format === "signage" || format === "image",
  isAvailable: () => true,
  publish: (item, outcome, now) => simulate(item, outcome, now, "physical"),
};

const PHYSICAL_CHANNELS: Channel[] = ["print", "digital_signage"];

/** The registered gateways, keyed by channel type. No live platform client exists. */
export const GATEWAYS: Record<ChannelType, DistributionChannelGateway> = {
  digital: digitalGateway,
  physical: physicalGateway,
};

export function channelTypeOf(channel: Channel): ChannelType {
  return PHYSICAL_CHANNELS.includes(channel) ? "physical" : "digital";
}

/** Pick the gateway for a channel by its type (DI-05 "selected by channel type"). */
export function selectGateway(channel: Channel): DistributionChannelGateway {
  return GATEWAYS[channelTypeOf(channel)];
}
