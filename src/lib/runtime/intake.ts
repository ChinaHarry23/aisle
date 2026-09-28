/**
 * Intake validation — UC-01 steps 4, 5 and extensions 3.a / 4.a / 5.a.
 *
 * The pipeline must not start on an incomplete or unusable brief, and the system
 * must say exactly what is wrong instead of inventing a product, audience, budget,
 * country or channel the founder did not provide.
 */

import type { BrandProfile, Campaign, Channel, Country, CampaignInput } from "@/lib/types";

export type ValidationProblem = {
  field: string;
  message: string;
  clause: string;
};

export const COUNTRIES: Country[] = ["AU", "NZ", "UK", "US"];

export const CHANNELS: Channel[] = ["instagram", "web", "email", "print", "digital_signage"];

export function isCountry(value: unknown): value is Country {
  return typeof value === "string" && (COUNTRIES as string[]).includes(value);
}

export function isChannel(value: unknown): value is Channel {
  return typeof value === "string" && (CHANNELS as string[]).includes(value);
}

function daysBetween(a: string, b: string) {
  const start = new Date(`${a}T00:00:00Z`).getTime();
  const end = new Date(`${b}T00:00:00Z`).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return Number.NaN;
  return Math.round((end - start) / 86_400_000);
}

export type IntakeInput = Pick<
  CampaignInput,
  | "name"
  | "product"
  | "category"
  | "targetAudience"
  | "objective"
  | "budget"
  | "channels"
  | "startDate"
  | "endDate"
  | "country"
>;

/** Required fields, usable values, and brand/country-law configuration. */
export function validateIntake(input: IntakeInput, brand: BrandProfile | null): ValidationProblem[] {
  const problems: ValidationProblem[] = [];
  const required: [keyof IntakeInput, string][] = [
    ["name", "Campaign name"],
    ["product", "Product"],
    ["category", "Category"],
    ["targetAudience", "Target audience"],
    ["objective", "Objective"],
  ];
  for (const [field, label] of required) {
    const value = input[field];
    if (typeof value !== "string" || value.trim().length < 3) {
      problems.push({
        field: String(field),
        message: `${label} is required (at least 3 characters).`,
        clause: "UC-01 step 4 / ext 3.a",
      });
    }
  }

  if (!Number.isFinite(input.budget) || input.budget <= 0) {
    problems.push({
      field: "budget",
      message: "Budget must be a usable amount greater than zero.",
      clause: "UC-01 ext 4.a",
    });
  } else if (input.budget > 5_000_000) {
    problems.push({
      field: "budget",
      message: "Budget is above the ceiling this workspace accepts; check the figure.",
      clause: "UC-01 ext 4.a",
    });
  }

  if (!Array.isArray(input.channels) || input.channels.length === 0) {
    problems.push({
      field: "channels",
      message: "Select at least one distribution channel.",
      clause: "UC-01 ext 4.a",
    });
  } else if (!input.channels.every(isChannel)) {
    problems.push({
      field: "channels",
      message: "One or more selected channels are not recognised.",
      clause: "UC-01 ext 4.a",
    });
  }

  if (!isCountry(input.country)) {
    problems.push({
      field: "country",
      message: "Country is not recognised.",
      clause: "UC-01 ext 4.a",
    });
  }

  const span = daysBetween(input.startDate, input.endDate);
  if (Number.isNaN(span)) {
    problems.push({
      field: "startDate",
      message: "Campaign dates must be valid dates.",
      clause: "UC-01 ext 4.a",
    });
  } else if (span < 0) {
    problems.push({
      field: "endDate",
      message: "End date is before the start date.",
      clause: "UC-01 ext 4.a",
    });
  } else if (span > 365) {
    problems.push({
      field: "endDate",
      message: "Campaign window is longer than a year; split it into cycles.",
      clause: "UC-01 ext 4.a",
    });
  }

  // Step 5: brand settings and country-law text must already exist.
  if (!brand) {
    problems.push({
      field: "brand",
      message: "Brand settings are missing. Complete Brand before launching.",
      clause: "UC-01 ext 5.a",
    });
  } else {
    if (!brand.retailerName?.trim()) {
      problems.push({
        field: "brand",
        message: "Brand retailer name is missing.",
        clause: "UC-01 ext 5.a",
      });
    }
    if (!brand.bannedTerms?.length) {
      problems.push({
        field: "brand",
        message: "Brand banned-terms list is empty — compliance cannot check claims.",
        clause: "UC-01 ext 5.a",
      });
    }
    if (isCountry(input.country) && !brand.countryRules?.[input.country]?.trim()) {
      problems.push({
        field: "brand",
        message: `No advertising-law profile is stored for ${input.country}.`,
        clause: "UC-01 ext 5.a",
      });
    }
  }

  return problems;
}

/** The digest AHR-04 records against each reviewed version. */
export function inputDigest(campaign: Campaign): string {
  const parts = [
    campaign.product,
    campaign.category,
    campaign.targetAudience,
    campaign.objective,
    campaign.country,
    campaign.channels.join("+"),
    campaign.brief?.keyMessage ?? "",
    `claims:${(campaign.sharedContext.approvedClaims ?? []).join("|")}`,
    `brand:${campaign.sharedContext.brandTone.slice(0, 24)}`,
  ];
  return parts.join(" · ");
}

/** Deterministic hash so a digest can be compared across submissions. */
export function digestHash(digest: string): string {
  let h = 0;
  for (let i = 0; i < digest.length; i += 1) h = (h * 33 + digest.charCodeAt(i)) % 0xffffffff;
  return h.toString(16).padStart(8, "0");
}
