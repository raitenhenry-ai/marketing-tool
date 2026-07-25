import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import config from "./config.js";

export function subtitlesEnabled() {
  return config.subtitles && Boolean(config.openaiApiKey);
}

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = "";
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with ${code}: ${stderr.slice(-800)}`));
    });
  });
}

async function transcribe(audioPath) {
  const form = new FormData();
  form.append("file", new Blob([fs.readFileSync(audioPath)], { type: "audio/mpeg" }), "clip.mp3");
  form.append("model", "whisper-1");
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "word");

  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${config.openaiApiKey}` },
    body: form,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Transcription failed (${res.status}): ${JSON.stringify(data)}`);
  return (data.words || [])
    .map((w) => ({ word: String(w.word || "").trim(), start: w.start, end: w.end }))
    .filter((w) => w.word);
}

export function assTime(seconds) {
  const s = Math.max(0, seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  const cs = Math.floor((s % 1) * 100);
  return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

export function escapeAssText(text) {
  return text.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")");
}

// Group words into short caption chunks (max 3 words, broken on pauses), then
// emit one dialogue event per word so only the word being spoken is highlighted.
export function buildAss(words, { width, height }) {
  const MAX_WORDS = 3;
  const MAX_GAP = 0.8;
  const MAX_CHUNK_SECONDS = 3.0;

  const chunks = [];
  let current = [];
  for (const w of words) {
    const prev = current[current.length - 1];
    const tooLong =
      current.length >= MAX_WORDS ||
      (prev && w.start - prev.end > MAX_GAP) ||
      (current.length && w.end - current[0].start > MAX_CHUNK_SECONDS);
    if (tooLong && current.length) {
      chunks.push(current);
      current = [];
    }
    current.push(w);
  }
  if (current.length) chunks.push(current);
  if (!chunks.length) return null;

  const fontSize = Math.round(height * 0.042);
  const outline = Math.max(2, Math.round(height * 0.0032));
  const shadow = Math.max(1, Math.round(height * 0.0016));
  const marginV = Math.round(height * 0.125); // sits above the site-domain bar
  const marginX = Math.round(width * 0.055);

  const HIGHLIGHT = "&H00FFFF&"; // yellow (ASS colours are BGR)
  const BASE = "&HFFFFFF&";

  const events = [];
  for (const chunk of chunks) {
    for (let i = 0; i < chunk.length; i++) {
      const start = chunk[i].start;
      const end = i + 1 < chunk.length ? chunk[i + 1].start : chunk[i].end + 0.15;
      if (end <= start) continue;
      const text = chunk
        .map((w, j) => {
          const word = escapeAssText(w.word.toUpperCase());
          return j === i ? `{\\c${HIGHLIGHT}}${word}{\\c${BASE}}` : word;
        })
        .join(" ");
      events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caps,,0,0,0,,${text}`);
    }
  }

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caps,DejaVu Sans,${fontSize},&H00FFFFFF,&H00FFFFFF,&H00000000,&H7F000000,-1,0,0,0,100,100,1,0,1,${outline},${shadow},2,${marginX},${marginX},${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}

// Transcribes the [start, start+length] window of the source video and writes
// an .ass subtitle file for the clip. Returns {assPath, transcript}, or null
// when the clip has no usable speech. Timestamps are relative to the clip
// start because only that window's audio is sent for transcription.
export async function generateClipSubtitles({ inputPath, start, length, outBase, width, height }) {
  const audioPath = `${outBase}.mp3`;
  try {
    await run(config.ffmpegPath, [
      "-y", "-ss", String(start), "-i", inputPath, "-t", String(length),
      "-vn", "-ac", "1", "-ar", "16000", "-c:a", "libmp3lame", "-b:a", "48k",
      audioPath,
    ]);
    const words = await transcribe(audioPath);
    if (!words.length) return null;

    const ass = buildAss(words, { width, height });
    if (!ass) return null;
    const assPath = `${outBase}.ass`;
    fs.writeFileSync(assPath, ass);
    return { assPath, transcript: words.map((w) => w.word).join(" ") };
  } finally {
    fs.rmSync(audioPath, { force: true });
  }
}
