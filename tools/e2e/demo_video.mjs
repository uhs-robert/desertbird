// Turns the film of the opt-in piece shots/demo into the demo video: burns the key captions, the title card of each part and the end card into the raw film and cuts a small WebM preview.
// Usage: node tools/e2e/demo_video.mjs <the out dir of the piece> <output dir> [name, default desertbird-demo]
// The piece (pieces/shots.demo.mjs) writes demo_raw.mp4 and demo_captions.json there. A caption has `text` (a key caption), `title` (a title card) or `end` (the end card, to the end of the film). Needs ffmpeg with libx264, libvpx-vp9 and drawtext.
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [piece_out_dir, output_dir, name = "desertbird-demo"] = process.argv.slice(2);
if (!piece_out_dir || !output_dir) {
  console.error("usage: node tools/e2e/demo_video.mjs <piece out dir> <output dir>");
  process.exit(2);
}
mkdirSync(output_dir, { recursive: true });
const raw = join(piece_out_dir, "demo_raw.mp4");
const captions = JSON.parse(readFileSync(join(piece_out_dir, "demo_captions.json"), "utf8"));
// DEMO_FONT names a font file. Without it fc-match picks a bold monospace font.
function find_font() {
  if (process.env.DEMO_FONT) return process.env.DEMO_FONT;
  try {
    const path = execFileSync("fc-match", ["-f", "%{file}", "monospace:bold"], { encoding: "utf8" }).trim();
    if (path) return path;
  } catch {}
  console.error("demo_video: no font found. Install fontconfig and a monospace font, or set DEMO_FONT to a font file.");
  process.exit(2);
}
const FONT = find_font();
// A drawtext option value goes through two escapes. The first is the option level: a backslash, a colon and a single quote get a backslash, because the filter splits its options at colons. The second is the filtergraph level: the same three, plus the comma and the brackets and semicolon that split filters and chains.
const escape_level = (value, specials) => value.replace(new RegExp(`[${specials}]`, "g"), "\\$&");
const escaped_option = (value) => escape_level(escape_level(value, "\\\\:'"), "\\\\:',;\\[\\]");
// wf-recorder starts a moment after the piece takes its clock, so DEMO_CAPTION_OFFSET_S (seconds, may be negative) shifts every caption.
const OFFSET_S = Number(process.env.DEMO_CAPTION_OFFSET_S ?? 0);
// A key caption stays until the next one, but never longer than this. A title card shows for TITLE_S.
const MAX_SHOW_S = 3;
const TITLE_S = 1.1;
const END_LINES = [["DesertBird", 96, -110], ["Vim keys for Thunderbird and Betterbird", 44, 20], ["addons.thunderbird.net", 40, 100]];

const text_dir = join(output_dir, "caption_text");
mkdirSync(text_dir, { recursive: true });
const filters = [];
let text_index = 0;
const text_option = (text) => {
  const text_file = join(text_dir, `${text_index++}.txt`);
  writeFileSync(text_file, text);
  return `fontfile=${escaped_option(FONT)}:textfile=${escaped_option(text_file)}`;
};
// The film starts at the first caption: the recorder runs a moment before the first key, and the first frame of the video is action.
const start_s = Math.max(0, (captions[0]?.at_ms ?? 0) / 1000 + OFFSET_S);
const at_s = (caption) => caption.at_ms / 1000 + OFFSET_S - start_s;
const key_captions = captions.filter((caption) => "text" in caption);
key_captions.forEach((caption, index) => {
  if (!caption.text) return;
  const from_s = at_s(caption);
  const next_s = key_captions[index + 1] ? at_s(key_captions[index + 1]) : from_s + MAX_SHOW_S;
  const until_s = Math.min(next_s, from_s + MAX_SHOW_S);
  filters.push(`drawtext=${text_option(caption.text)}:fontsize=44:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=14:x=w-tw-40:y=h-th-70:enable='between(t,${from_s.toFixed(2)},${until_s.toFixed(2)})'`);
});
for (const caption of captions.filter((caption) => caption.title)) {
  const from_s = at_s(caption);
  filters.push(`drawtext=${text_option(caption.title)}:fontsize=76:fontcolor=white:box=1:boxcolor=black@0.8:boxborderw=30:x=(w-tw)/2:y=(h-th)/2:enable='between(t,${from_s.toFixed(2)},${(from_s + TITLE_S).toFixed(2)})'`);
}
const end = captions.find((caption) => caption.end);
if (end) {
  const from = `gte(t,${at_s(end).toFixed(2)})`;
  filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=0x1d1f24:t=fill:enable='${from}'`);
  for (const [text, size, offset] of END_LINES) filters.push(`drawtext=${text_option(text)}:fontsize=${size}:fontcolor=white:x=(w-tw)/2:y=(h-th)/2+(${offset}):enable='${from}'`);
}
const video = join(output_dir, `${name}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", start_s.toFixed(2), "-i", raw, "-vf", filters.join(",") || "null", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", video], { stdio: "inherit" });
const preview = join(output_dir, `${name}-preview.webm`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "fps=10,scale=800:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-an", preview], { stdio: "inherit" });
console.log(video);
console.log(preview);
