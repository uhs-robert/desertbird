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
const MAX_SHOW_S = 6;
const TITLE_S = 1.8;
const CARD_COLOR = "0x1d1f24";
// The logo is the add-on icon. Its small mark sits in the empty middle of the spaces bar, above the command line list, and the cards show it large.
const LOGO = process.env.DEMO_LOGO ?? new URL("../../src/icons/desertbird-128.png", import.meta.url).pathname;
const MARK_PX = 34;
const MARK_X = 6;
const MARK_Y = 400;
const CARD_LOGO_PX = 128;
const CARD_LOGO_Y = 140;
const END_LINES = [["DesertBird", 84, 30], ["Vim keys for Thunderbird and Betterbird", 40, 150], ["addons.thunderbird.net", 34, 215]];

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
const card_windows = [];
// Key captions are a thin strip over the quick search box at the top: nothing in the shots moves there.
const key_captions = captions.filter((caption) => "text" in caption);
key_captions.forEach((caption, index) => {
  if (!caption.text) return;
  const from_s = at_s(caption);
  const next_s = key_captions[index + 1] ? at_s(key_captions[index + 1]) : from_s + MAX_SHOW_S;
  const until_s = Math.min(next_s, from_s + MAX_SHOW_S);
  filters.push(`drawtext=${text_option(caption.text)}:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.7:boxborderw=6:x=290:y=10:enable='between(t,${from_s.toFixed(2)},${until_s.toFixed(2)})'`);
});
// A title card hides the film for TITLE_S, the same length the piece waits.
const logo_overlays = [];
for (const caption of captions.filter((caption) => caption.title)) {
  const from_s = at_s(caption);
  const window = `between(t,${from_s.toFixed(2)},${(from_s + TITLE_S).toFixed(2)})`;
  card_windows.push(window);
  filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${CARD_COLOR}:t=fill:enable='${window}'`);
  filters.push(`drawtext=${text_option("DesertBird")}:fontsize=36:fontcolor=0xd9a066:x=(w-tw)/2:y=${CARD_LOGO_Y + CARD_LOGO_PX + 30}:enable='${window}'`);
  filters.push(`drawtext=${text_option(caption.title)}:fontsize=64:fontcolor=white:x=(w-tw)/2:y=${CARD_LOGO_Y + CARD_LOGO_PX + 110}:enable='${window}'`);
  logo_overlays.push(window);
}
const end = captions.find((caption) => caption.end);
if (end) {
  const from = `gte(t,${at_s(end).toFixed(2)})`;
  card_windows.push(from);
  filters.push(`drawbox=x=0:y=0:w=iw:h=ih:color=${CARD_COLOR}:t=fill:enable='${from}'`);
  for (const [text, size, offset] of END_LINES) filters.push(`drawtext=${text_option(text)}:fontsize=${size}:fontcolor=white:x=(w-tw)/2:y=${CARD_LOGO_Y + CARD_LOGO_PX + offset}:enable='${from}'`);
  logo_overlays.push(from);
}
const on_card = card_windows.length ? card_windows.join("+") : "0";
const graph = [
  `[0:v]${filters.join(",") || "null"}[text]`,
  `[1:v]split=2[mark_in][card_in]`,
  `[mark_in]scale=${MARK_PX}:-1[mark]`,
  `[card_in]scale=${CARD_LOGO_PX}:-1[card]`,
  `[text][mark]overlay=${MARK_X}:${MARK_Y}:enable='not(${on_card})'[marked]`,
  `[marked][card]overlay=(W-w)/2:${CARD_LOGO_Y}:enable='${logo_overlays.join("+")}'[out]`,
].join(";");
// The looped logo input is cut at the length of the film, or the overlay never ends.
const film_s = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw], { encoding: "utf8" })) - start_s;
const video = join(output_dir, `${name}.mp4`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-ss", start_s.toFixed(2), "-i", raw, "-loop", "1", "-t", film_s.toFixed(2), "-i", LOGO, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-crf", "20", "-preset", "medium", "-movflags", "+faststart", video], { stdio: "inherit" });
const preview = join(output_dir, `${name}-preview.webm`);
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", video, "-vf", "fps=10,scale=800:-2", "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "42", "-an", preview], { stdio: "inherit" });
console.log(video);
console.log(preview);
