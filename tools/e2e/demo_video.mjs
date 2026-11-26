// Turns the film of the opt-in piece shots/demo into the demo video: burns the key captions into the raw film and cuts a small WebM preview.
// Usage: node tools/e2e/demo_video.mjs <the out dir of the piece> <output dir>
// The piece (pieces/shots.demo.mjs) writes demo_raw.mp4 and demo_captions.json there. Needs ffmpeg with libx264, libvpx-vp9 and drawtext.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [piece_out_dir, output_dir] = process.argv.slice(2);
if (!piece_out_dir || !output_dir) {
  console.error("usage: node tools/e2e/demo_video.mjs <piece out dir> <output dir>");
  process.exit(2);
}
mkdirSync(output_dir, { recursive: true });
const raw = join(piece_out_dir, "demo_raw.mp4");
const captions = JSON.parse(readFileSync(join(piece_out_dir, "demo_captions.json"), "utf8"));
const FONT = process.env.DEMO_FONT ?? "/usr/share/fonts/TTF/JetBrainsMonoNLNerdFontPropo-Bold.ttf";
// wf-recorder starts a moment after the piece takes its clock, so the captions shift by this much.
const OFFSET_S = Number(process.env.DEMO_CAPTION_OFFSET_S ?? 0);
// A caption stays until the next one, but never longer than this.
const MAX_SHOW_S = 3;

const text_dir = join(output_dir, "caption_text");
mkdirSync(text_dir, { recursive: true });
const filters = [];
captions.forEach((caption, index) => {
  if (!caption.text) return;
  const from_s = caption.at_ms / 1000 + OFFSET_S;
  const next_s = captions[index + 1] ? captions[index + 1].at_ms / 1000 + OFFSET_S : from_s + MAX_SHOW_S;
  const until_s = Math.min(next_s, from_s + MAX_SHOW_S);
  const text_file = join(text_dir, `${index}.txt`);
  writeFileSync(text_file, caption.text);
  filters.push(`drawtext=fontfile=${FONT}:textfile=${text_file}:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=14:x=w-tw-40:y=h-th-70:enable='between(t,${from_s.toFixed(2)},${until_s.toFixed(2)})'`);
});
const video = join(output_dir, "desertbird-demo.mp4");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", raw, "-vf", filters.join(",") || "null", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", video], { stdio: "inherit" });
const preview = join(output_dir, "desertbird-demo-preview.webm");
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "fps=10,scale=800:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-an", preview], { stdio: "inherit" });
console.log(video);
console.log(preview);
