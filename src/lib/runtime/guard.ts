/**
 * Policy guard — UC-01 step 13 and extension 13.a.
 *
 * "Agents may research, draft and check; they may not publish, spend above the
 * founder's budget threshold, change the agreed scope, or send a catalogue cover
 * live without a human decision."
 *
 * Every agent action the engine is about to take is evaluated here first. A
 * refusal is not an error: it is a recorded `PolicyDecision` plus a campaign log
 * line, and the engine routes the work to the founder instead. The founder is
 * the only actor that may publish or spend.
 */

import { uid } from "@/lib/ids";
import type { Campaign } from "@/lib/types";
import type { Actor, GuardRuleId, GuardVerdict, GuardedAction, PolicyDecision } from "./types";

export type GuardInput = {
  actor: Actor;
  action: GuardedAction;
  campaign: Campaign;
  /** Human-readable description of what is being attempted. */
  target: string;
  /** Money involved, for spend actions. */
  amountUsd?: number;
  /** Set when the attempt originates from a run step. */
  triggeredBy?: string;
  /** Optional channel context, e.g. a print lock. */
  kind?: "catalogue_cover" | "social" | "web" | "email" | "signage";
  /** Human-readable description of what should change instead. */
  remedy?: string;
  /** Free-text detail used by some rules (e.g. the claim being edited). */
  detail?: string;
};

export type GuardOutcome = {
  verdict: GuardVerdict;
  rule: GuardRuleId;
  clause: string;
  reason: string;
  remedy?: string;
  decision: PolicyDecision;
};

type Rule = {
  id: GuardRuleId;
  clause: string;
  /** True when this rule applies to the attempted action. */
  applies: (input: GuardInput) => boolean;
  /** 'block' refuses the action; 'allow_with_note' permits it but records why. */
  evaluate: (input: GuardInput) => { verdict: GuardVerdict; reason: string; remedy?: string };
};

const FOUNDER_ONLY = "Only the Human Founder may do this (UC-01 step 13).";

function isPrintLock(campaign: Campaign, input: GuardInput) {
  return (
    input.kind === "catalogue_cover" ||
    (campaign.channels.includes("print") && input.action === "PUBLISH_CONTENT")
  );
}

const rules: Rule[] = [
  {
    id: "AHR-01-R13.publish",
    clause: "UC-01 step 13 / ext 13.a · AHR-04 step 12",
    applies: (i) => i.action === "PUBLISH_CONTENT",
    evaluate: (i) => {
      if (i.actor === "founder") {
        return {
          verdict: "allow",
          reason: "Founder decision — the only actor permitted to publish.",
        };
      }
      if (isPrintLock(i.campaign, i)) {
        return {
          verdict: "block",
          reason: `The ${i.target} includes a print/catalogue piece. A catalogue cover is a founder decision and may not be sent live by an agent.`,
          remedy: "Founder opens Approvals and approves the print lock explicitly.",
        };
      }
      return {
        verdict: "block",
        reason: `Agent "${i.actor}" attempted to publish ${i.target}. Agents may research, draft and check only.`,
        remedy: FOUNDER_ONLY,
      };
    },
  },
  {
    id: "AHR-01-R13.spend",
    clause: "UC-01 step 13 / ext 13.a",
    applies: (i) => i.action === "SPEND_MEDIA",
    evaluate: (i) => {
      const amount = i.amountUsd ?? 0;
      const cap = i.campaign.spendCapUsd ?? i.campaign.spend.capUsd;
      if (i.actor === "founder") {
        return { verdict: "allow", reason: "Founder-set spend." };
      }
      if (amount > cap) {
        return {
          verdict: "block",
          reason: `Commitment of $${amount.toFixed(2)} exceeds the founder's automated spend threshold of $${cap.toFixed(2)} for this campaign.`,
          remedy: "Founder raises the cap on the brief, or commits the spend manually.",
        };
      }
      const already = i.campaign.spend.mediaUsd + i.campaign.spend.inferenceUsd;
      if (already + amount > cap) {
        return {
          verdict: "block",
          reason: `Cumulative agent spend would reach $${(already + amount).toFixed(2)}, above the $${cap.toFixed(2)} threshold.`,
          remedy: "Founder raises the cap or approves the overage.",
        };
      }
      return {
        verdict: "allow_with_note",
        reason: `Within the founder's $${cap.toFixed(2)} threshold.`,
      };
    },
  },
  {
    id: "AHR-04-R12.approve-own-work",
    clause: "AHR-04 · UC-04 step 12/13",
    applies: (i) => i.action === "APPROVE_OWN_WORK",
    evaluate: (i) =>
      i.actor === "founder"
        ? { verdict: "allow", reason: "Human approval recorded." }
        : {
            verdict: "block",
            reason: `Agent "${i.actor}" attempted to approve its own output. The Compliance Checker may analyse, flag and recommend, but must not approve.`,
            remedy: "Route to the Retail Marketing Manager for sign-off.",
          },
  },
  {
    id: "AHR-05-R.claims-frozen",
    clause: "AHR-05 · 'without changing the claims, imagery or wording that AHR-04 has already cleared'",
    applies: (i) => i.action === "EDIT_APPROVED_CLAIM",
    evaluate: (i) => ({
      verdict: "block",
      reason: `Adaptation for ${i.target} would change cleared wording${i.detail ? ` (${i.detail})` : ""}. Claims cleared by AHR-04 are frozen for distribution.`,
      remedy: "Send the change back through AHR-03 → AHR-04, or adapt within the cleared wording.",
    }),
  },
  {
    id: "AHR-05-R.scope",
    clause: "AHR-05 · 'not publish outside the channels, dates or budget the founder set in AHR-01'",
    applies: (i) => i.action === "CHANGE_CAMPAIGN_SCOPE",
    evaluate: (i) => ({
      verdict: "block",
      reason: `Agent "${i.actor}" attempted to change the agreed campaign scope${i.detail ? ` (${i.detail})` : ""}.`,
      remedy: "Founder edits the brief; the run then works to the new scope.",
    }),
  },
  {
    id: "AHR-05-R.no-silent-skip",
    clause: "AHR-05 · 'should not retry indefinitely or skip the item silently'",
    applies: (i) => i.action === "SKIP_ITEM_SILENTLY",
    evaluate: (i) => ({
      verdict: "block",
      reason: `Skipping ${i.target} without recording it is not permitted.`,
      remedy: "Raise the item as an exception for the founder instead.",
    }),
  },
  {
    id: "AHR-02-R.privacy",
    clause: "UC-02 ext 4.b / 4.c · AHR-02 'using only authorised information'",
    applies: (i) =>
      i.action === "IMPORT_UNAUTHORISED_DATA" || i.action === "READ_INTERNAL_DATA",
    evaluate: (i) => {
      const authorised = i.campaign.internalDataAuthorised === true;
      if (i.action === "IMPORT_UNAUTHORISED_DATA") {
        return {
          verdict: "block",
          reason: `"${i.target}" is not on the authorised source list for this retailer.`,
          remedy: "Founder authorises the source on Brand, or the analysis runs without it.",
        };
      }
      if (!authorised) {
        return {
          verdict: "block",
          reason: `Internal retail data (${i.target}) has not been authorised for this campaign.`,
          remedy: "Founder authorises internal retail data on Brand; external public sources are still used.",
        };
      }
      return {
        verdict: "allow_with_note",
        reason: "Internal retail data is authorised for this campaign.",
      };
    },
  },
];

/** Evaluate one attempted action. Returns allow, allow-with-note, or block. */
export function evaluateGuard(input: GuardInput, at: string): GuardOutcome {
  const rule = rules.find((r) => r.applies(input));
  const evaluated = rule
    ? rule.evaluate(input)
    : {
        verdict: "allow" as GuardVerdict,
        reason: "No policy restriction applies to this action.",
      };
  const matchedRule = rule?.id ?? "AHR-01-R13.publish";
  const clause = rule?.clause ?? "UC-01 step 13";

  const decision: PolicyDecision = {
    id: uid("pd"),
    at,
    actor: input.actor,
    action: input.action,
    verdict: evaluated.verdict,
    rule: matchedRule,
    clause,
    target: input.target,
    reason: evaluated.reason,
    remedy:
      evaluated.verdict === "block"
        ? (evaluated.remedy ?? input.remedy)
        : input.remedy,
    triggeredBy: input.triggeredBy,
  };

  return {
    verdict: evaluated.verdict,
    rule: matchedRule,
    clause,
    reason: evaluated.reason,
    remedy: decision.remedy,
    decision,
  };
}

/** Convenience predicate for the engine's hot paths. */
export function wouldBlock(input: GuardInput, at: string): boolean {
  return evaluateGuard(input, at).verdict === "block";
}

export const guardRuleCatalogue: { id: GuardRuleId; clause: string; text: string }[] = rules.map(
  (r) => ({
    id: r.id,
    clause: r.clause,
    text: r.id,
  }),
);
