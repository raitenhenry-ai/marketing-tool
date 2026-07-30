import { assTime, escapeAssText } from "./transcribe.js";

// Renders the "PART N" badge and the site-domain badge as ASS events instead
// of ffmpeg drawtext: libass gives rounded pill outlines, soft shadows and
// letter spacing, which look far better than drawtext's square boxes.
//
// The pill effect comes from a thick outline in the brand colour - ASS
// outlines follow the glyph shapes with rounded joins, so a heavy border
// around bold text reads as a rounded badge.

const BRAND_BLUE = "&H00ED6F2F&"; // #2F6FED in ASS BGR order
const SHADOW = "&H96000000&";

export function buildOverlayAss({ partLabel, siteDomain, width, height, durationSeconds }) {
  const end = assTime(durationSeconds + 1);

  const partSize = Math.round(height * 0.036);
  const partBord = Math.round(partSize * 0.42);
  const domainSize = Math.round(height * 0.028);
  const domainBord = Math.round(domainSize * 0.42);
  // Keep overlays inside the platform "safe zone": Shorts/Reels/TikTok draw
  // their own UI over the top ~8% (tabs) and bottom ~22-25% (caption, music,
  // progress bar), so the badge sits below the top bar and the domain sits
  // above the bottom UI band.
  const topMargin = Math.round(height * 0.09);
  const bottomMargin = Math.round(height * 0.26);

  const events = [];
  if (partLabel) {
    events.push(
      `Dialogue: 0,0:00:00.00,${end},Badge,,0,0,0,,{\\be1}${escapeAssText(partLabel.toUpperCase())}`
    );
  }
  events.push(
    `Dialogue: 0,0:00:00.00,${end},Domain,,0,0,0,,{\\be1}${escapeAssText(siteDomain)}`
  );

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Badge,DejaVu Sans,${partSize},&H00FFFFFF,&H00FFFFFF,${BRAND_BLUE},${SHADOW},-1,0,0,0,100,100,2,0,1,${partBord},3,8,60,60,${topMargin},1
Style: Domain,DejaVu Sans,${domainSize},&H00FFFFFF,&H00FFFFFF,${BRAND_BLUE},${SHADOW},-1,0,0,0,100,100,1,0,1,${domainBord},2,2,60,60,${bottomMargin},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events.join("\n")}
`;
}
