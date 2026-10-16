/** Real video editing and technical verification; no generative placeholder frames. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { StoryAdPlan } from "./storyboard";

const run = promisify(execFile);
const encode = (args: string[]) => run(process.env.AISLE_FFMPEG || "ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-n", ...args], { timeout: 10 * 60_000, maxBuffer: 8_000_000 });
const codecs = ["-c:v", "libx264", "-preset", "fast", "-crf", "19", "-pix_fmt", "yuv420p", "-r", "24", "-c:a", "aac", "-ar", "48000", "-ac", "2", "-movflags", "+faststart"];
type Probe = { streams: { codec_type: string; width?: number; height?: number; nb_frames?: string; avg_frame_rate?: string }[]; format: { duration: string } };
export async function probeVideo(file: string): Promise<Probe> {
  return JSON.parse((await run(process.env.AISLE_FFPROBE || "ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { timeout: 30_000 })).stdout);
}
export async function requireStoryEditor() {
  if (process.env.VERCEL) throw new Error("30-second story production needs the local background worker; cloud clip generation is unchanged.");
  await Promise.all([run(process.env.AISLE_FFMPEG || "ffmpeg", ["-version"]), run(process.env.AISLE_FFPROBE || "ffprobe", ["-version"])]);
}
export async function verifyScene(file: string, seconds: number) {
  const metadata = await probeVideo(file);
  if (!metadata.streams.some(s => s.codec_type === "video") || Number(metadata.format.duration) < seconds - 1 / 24) throw new Error("A rendered scene is too short or has no video. It will not be looped into a fake longer ad.");
  await run(process.env.AISLE_FFMPEG || "ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-f", "null", "-"], { timeout: 5 * 60_000, maxBuffer: 8_000_000 });
  const analysis = await run(process.env.AISLE_FFMPEG || "ffmpeg", ["-v", "error", "-nostdin", "-i", file, "-vf", "signalstats,metadata=print:file=-", "-an", "-f", "null", "-"], { timeout: 5 * 60_000, maxBuffer: 8_000_000 });
  const levels = [...analysis.stdout.matchAll(/lavfi\.signalstats\.YMAX=([\d.]+)/g)].map(m => Number(m[1]));
  if (!levels.length || levels.every(value => value <= 18)) throw new Error("The rendered scene is all black; the production is stopped and its output retained.");
  return metadata;
}
const xml = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
function wrap(text: string, max: number) {
  const lines: string[] = [];
  for (const word of text.split(/\s+/)) {
    if (!word) continue;
    const last = lines.length - 1;
    if (last < 0 || lines[last].length + word.length + 1 > max) lines.push(word);
    else lines[last] += ` ${word}`;
  }
  return lines;
}
/** Full copy is wrapped and font-fitted; never truncate a claim/qualifier to fit. */
export function endCardSvg(plan: StoryAdPlan, width: number, height: number) {
  const rows = [
    { text: plan.endCard.product, y: 105, size: 52, area: 150 },
    { text: plan.endCard.headline, y: 290, size: 42, area: 150 },
    { text: plan.endCard.cta, y: 490, size: 32, area: 100 },
  ];
  const text = rows.map(row => {
    let size = row.size;
    let lines = wrap(row.text, Math.floor(1100 / (size * 0.7)));
    while (lines.length * size * 1.25 > row.area && size > 14) {
      size -= 2; lines = wrap(row.text, Math.floor(1100 / (size * 0.7)));
    }
    if (lines.length * size * 1.25 > row.area || lines.some(line => line.length * size * 0.7 > 1100)) throw new Error("Closing-card copy is too long to display legibly. Shorten the campaign headline or CTA before rendering.");
    return lines.map((line, i) => `<text x="640" y="${row.y + i * size * 1.25}" text-anchor="middle" font-family="Arial, sans-serif" font-size="${size}" fill="#253b2a">${xml(line)}</text>`).join("");
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 1280 720"><rect width="1280" height="720" fill="#f4efe4"/><rect x="590" y="240" width="100" height="3" fill="#a9783b"/>${text}<text x="640" y="666" text-anchor="middle" font-family="Arial, sans-serif" font-size="17" fill="#687363">Campaign draft · human review required</text></svg>`;
}
export async function prepareEndCard(folder: string, plan: StoryAdPlan, width: number, height: number) {
  await sharp(Buffer.from(endCardSvg(plan, width, height))).png().toFile(path.join(folder, "end-card.png"));
}
export async function editStoryAd(folder: string, plan: StoryAdPlan, files: string[], width: number, height: number) {
  if (files.length !== plan.scenes.length) throw new Error("Every story scene must finish before editing the ad.");
  const parts: string[] = [];
  for (const [i, file] of files.entries()) {
    const metadata = await verifyScene(file, plan.scenes[i].durationSec);
    const seconds = plan.scenes[i].durationSec;
    const part = path.join(folder, `part-${i + 1}.mp4`);
    const audio = metadata.streams.some(s => s.codec_type === "audio");
    const filters = `[0:v]trim=duration=${seconds},setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1,fps=24[v];[${audio ? "0" : "1"}:a]aresample=48000,aformat=channel_layouts=stereo,apad,atrim=duration=${seconds},asetpts=PTS-STARTPTS,afade=t=in:d=0.12,afade=t=out:st=${seconds - 0.15}:d=0.15[a]`;
    await encode(["-i", file, ...(!audio ? ["-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo"] : []), "-filter_complex", filters, "-map", "[v]", "-map", "[a]", "-t", String(seconds), ...codecs, part]);
    parts.push(part);
  }
  // Four seconds of deliberately authored brand/CTA, not a repeated generated clip.
  const card = path.join(folder, "closing-card.mp4");
  await encode(["-loop", "1", "-i", path.join(folder, "end-card.png"), "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo", "-t", "4", ...codecs, card]);
  parts.push(card);
  const output = path.join(folder, "campaign-30s-ad.mp4");
  await encode([...parts.flatMap(file => ["-i", file]), "-filter_complex", parts.map((_, i) => `[${i}:v][${i}:a]`).join("") + `concat=n=${parts.length}:v=1:a=1[v][a]`, "-map", "[v]", "-map", "[a]", "-t", "30", ...codecs, output]);
  const metadata = await probeVideo(output);
  const video = metadata.streams.find(s => s.codec_type === "video");
  if (!video || video.width !== width || video.height !== height || Math.abs(Number(metadata.format.duration) - 30) > 0.06 || Number(video.nb_frames) !== 720 || video.avg_frame_rate !== "24/1") throw new Error("The finished ad failed 30-second / 720-frame / resolution verification.");
  await writeFile(path.join(folder, "ffprobe.json"), JSON.stringify(metadata, null, 2));
  await run(process.env.AISLE_FFMPEG || "ffmpeg", ["-v", "error", "-nostdin", "-i", output, "-f", "null", "-"], { timeout: 5 * 60_000, maxBuffer: 8_000_000 });
  await encode(["-i", output, "-vf", "fps=1/3,scale=320:180,tile=5x2", "-frames:v", "1", path.join(folder, "contact-sheet.png")]);
  return { file: output, bytes: await readFile(output), metadata };
}
