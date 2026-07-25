// Parses user-supplied cut times. Two formats:
//   Cut points:  "2:00, 5:30, 9:15"      -> split the video at those times
//   Ranges:      "0:30-2:10" (per line)  -> each range becomes one clip, in
//                                           the order given (content between
//                                           ranges is skipped)
// Times accept "SS", "M:SS" or "H:MM:SS", with optional decimals.

export function parseTime(str) {
  const s = str.trim();
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(s)) {
    throw new Error(`"${s}" is not a valid time (use SS, M:SS or H:MM:SS)`);
  }
  const parts = s.split(":").map(Number);
  let seconds = 0;
  for (const p of parts) {
    if (p >= 60 && parts.length > 1 && p !== parts[0]) {
      throw new Error(`"${s}" is not a valid time (minutes/seconds must be under 60)`);
    }
    seconds = seconds * 60 + p;
  }
  return seconds;
}

// Returns an array of {start, end} segments; end === null means "to the end
// of the video". Returns null for empty input (use the default splitting).
export function parseCuts(text) {
  const entries = String(text || "")
    .split(/[\n,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  if (!entries.length) return null;

  const isRange = (e) => /.-/.test(e) || e.endsWith("-");
  const rangeCount = entries.filter(isRange).length;
  if (rangeCount && rangeCount !== entries.length) {
    throw new Error("Don't mix cut points and ranges - use one style or the other");
  }

  if (rangeCount) {
    return entries.map((entry) => {
      const m = entry.match(/^(.+?)\s*-\s*(.*)$/);
      if (!m) throw new Error(`"${entry}" is not a valid range (use start-end)`);
      const start = parseTime(m[1]);
      const end = m[2] ? parseTime(m[2]) : null;
      if (end !== null && end <= start) {
        throw new Error(`Range "${entry}" ends before it starts`);
      }
      return { start, end };
    });
  }

  const points = [...new Set(entries.map(parseTime))].sort((a, b) => a - b).filter((t) => t > 0);
  if (!points.length) return null;
  const segments = [];
  let prev = 0;
  for (const t of points) {
    segments.push({ start: prev, end: t });
    prev = t;
  }
  segments.push({ start: prev, end: null });
  return segments;
}

// Clamps parsed segments to the real video duration, dropping anything that
// falls entirely outside it or is shorter than half a second.
export function resolveSegments(segments, duration) {
  return segments
    .map(({ start, end }) => ({
      start,
      end: Math.min(end ?? duration, duration),
    }))
    .filter(({ start, end }) => start < duration && end - start >= 0.5);
}
