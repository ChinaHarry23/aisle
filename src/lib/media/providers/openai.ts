/**
 * OpenAI Images API (GPT Image 2). One synchronous call returns base64 bytes
 * and the token usage the call is billed on. OpenAI has no video model left
 * (the Videos API shut down on 24 Sep 2026).
 */
import { randomUUID } from "node:crypto";
import type { AspectRatio } from "../pr2-types";
import { assertMediaBytes } from "../store";
import { afterSubmit, apiBase, envValue, providerJson, ProviderError, roundUsd } from "./http";
import type { MediaProviderAdapter } from "./types";

/** Image-input tokens (edits) are billed at $8 per 1M; posters send none today. */
const IMAGE_INPUT_PER_M = 8;

/** GPT Image 2.5 takes any size with sides divisible by 16; 4:5 and 9:16 are exact, not the nearest stock size. */
const SIZES: Record<AspectRatio, string> = {
  "4:5": "1024x1280",
  "3:4": "1152x1536",
  "1:1": "1024x1024",
  "9:16": "1152x2048",
  "16:9": "2048x1152",
};

type ImagesResponse = {
  data?: { b64_json?: string }[];
  output_format?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    input_tokens_details?: { text_tokens?: number; image_tokens?: number };
  };
};

export const openaiAdapter: MediaProviderAdapter = {
  id: "openai",
  keyEnv: ["OPENAI_API_KEY"],
  async generate(req, { model, startImage, apiKey, onQueued, signal }) {
    if (model.kind !== "image") throw new ProviderError("OpenAI has no video model available.", { retryable: false });
    const key = apiKey?.trim() || envValue("OPENAI_API_KEY");
    if (!key) throw new ProviderError("OPENAI_API_KEY is not set.", { retryable: false });
    const jobId = `openai:${randomUUID()}`;
    onQueued?.(jobId);
    const aspect = req.aspectRatio ?? "4:5";
    const quality = req.quality ?? (model.id.endsWith("-high") ? "high" : "medium");
    const baseUrl = apiBase("OPENAI_API_BASE", "https://api.openai.com/v1");
    let body: ImagesResponse;
    try {
      if (startImage) {
        const form = new FormData();
        form.set("model", model.apiModel);
        form.set("prompt", req.prompt);
        form.set("n", "1");
        form.set("size", SIZES[aspect]);
        form.set("quality", quality);
        form.set("output_format", "jpeg");
        form.set("output_compression", "92");
        form.append("image", new Blob([new Uint8Array(startImage.bytes)], { type: startImage.mime }), "product.jpg");
        body = await providerJson<ImagesResponse>("OpenAI", `${baseUrl}/images/edits`, {
          headers: { Authorization: `Bearer ${key}` },
          form,
          timeoutMs: 240_000,
          signal,
        });
      } else {
        body = await providerJson<ImagesResponse>("OpenAI", `${baseUrl}/images/generations`, {
          headers: { Authorization: `Bearer ${key}` },
          // JPEG keeps a poster well under the 4.5 MB a Vercel response can carry.
          body: { model: model.apiModel, prompt: req.prompt, n: 1, size: SIZES[aspect], quality, output_format: "jpeg", output_compression: 92, moderation: "auto" },
          timeoutMs: 240_000,
          signal,
        });
      }
    } catch (error) {
      if (error instanceof ProviderError && error.code === "moderation_blocked") {
        throw new ProviderError("OpenAI declined this prompt under its content policy. Nothing was charged; edit the brief before trying again.", { status: error.status, code: error.code, retryable: false });
      }
      throw error;
    }
    const b64 = body.data?.[0]?.b64_json;
    if (!b64) throw new ProviderError("OpenAI returned no image.");
    const bytes = Buffer.from(b64, "base64");
    // The image was generated and billed; unusable bytes still settle the hold.
    const mime = await afterSubmit(async () => assertMediaBytes(bytes, "image"));
    const billing = model.billing.mode === "tokens" ? model.billing : { textInPerM: 5, imageOutPerM: 30, estOutTokens: 0 };
    const usage = body.usage;
    if (!usage || typeof usage.output_tokens !== "number") {
      // No usage block: bill the catalog estimate and say so rather than charging nothing.
      const estimate = (billing.estOutTokens / 1e6) * billing.imageOutPerM;
      return { bytes, mime, costUsd: roundUsd(estimate), jobId, aspect, outputTokens: billing.estOutTokens, note: "OpenAI sent no usage; billed the list estimate." };
    }
    const textIn = usage.input_tokens_details?.text_tokens ?? usage.input_tokens ?? 0;
    const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
    const costUsd = (textIn * billing.textInPerM + imageIn * IMAGE_INPUT_PER_M + usage.output_tokens * billing.imageOutPerM) / 1e6;
    return { bytes, mime, costUsd: roundUsd(costUsd), jobId, aspect, inputTokens: usage.input_tokens ?? textIn + imageIn, outputTokens: usage.output_tokens };
  },
};
