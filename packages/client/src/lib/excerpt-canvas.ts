import type { NativeIntegrations } from "@marinara-engine/shared";
export type ExcerptMark = {
  start: number;
  end: number;
  type: "highlight" | "underline" | "hide" | "replace";
  value?: string;
};
export function remapExcerptMarks(marks: ExcerptMark[], before: string, after: string) {
  let start = 0,
    end = before.length,
    nextEnd = after.length;
  while (start < end && start < nextEnd && before[start] === after[start]) start++;
  while (end > start && nextEnd > start && before[end - 1] === after[nextEnd - 1]) {
    end--;
    nextEnd--;
  }
  const delta = nextEnd - end;
  return marks.flatMap((mark) =>
    mark.end <= start
      ? [mark]
      : mark.start >= end
        ? [{ ...mark, start: mark.start + delta, end: mark.end + delta }]
        : [],
  );
}

export async function drawExcerpt(
  canvas: HTMLCanvasElement,
  text: string,
  marks: ExcerptMark[],
  settings: NativeIntegrations["excerpt"],
  inheritedFont: string,
) {
  await document.fonts.ready;
  const font = settings.fontFamily || inheritedFont;
  await document.fonts.load(`${settings.fontSize}px ${font}`);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.font = `${settings.fontSize}px ${font}`;
  const contentWidth = settings.width - 2 * settings.padding;
  const lineHeight = settings.fontSize * settings.lineHeight;
  type Glyph = {
    text: string;
    x: number;
    y: number;
    width: number;
    highlight: boolean;
    underline: boolean;
    hidden: boolean;
    quote: boolean;
  };
  const glyphs: Glyph[] = [];
  let x = settings.padding,
    y = settings.padding + settings.fontSize,
    quote = false;
  const titleHeight = settings.title ? lineHeight * 1.7 : 0;
  y += titleHeight;
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const segments = [...segmenter.segment(text)];
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    const replacement = marks.find(
      (mark) => mark.type === "replace" && mark.start <= segment.index && mark.end > segment.index,
    );
    if (replacement && segment.index !== replacement.start) continue;
    const visible = replacement ? (replacement.value ?? "") : segment.segment;
    const active = marks.filter((mark) => mark.start <= segment.index && mark.end > segment.index);
    for (const { segment: char } of segmenter.segment(visible)) {
      if (char === "\n") {
        x = settings.padding;
        y += lineHeight;
        continue;
      }
      const width = context.measureText(char).width + settings.letterSpacing;
      if (x > settings.padding && x + width > settings.padding + contentWidth) {
        x = settings.padding;
        y += lineHeight;
      }
      if (/["“”「」『』]/.test(char)) quote = !quote;
      glyphs.push({
        text: char,
        x,
        y,
        width,
        quote,
        highlight: active.some((mark) => mark.type === "highlight"),
        underline: active.some((mark) => mark.type === "underline"),
        hidden: active.some((mark) => mark.type === "hide"),
      });
      x += width;
    }
  }
  const footer = settings.author ? lineHeight * 1.5 : 0;
  const requiredHeight = Math.ceil(y + settings.padding + footer);
  const height = settings.height || requiredHeight;
  if (height < requiredHeight || height > 5000 || settings.width * height > 10_000_000)
    throw new Error("Excerpt does not fit the selected image size");
  const density = Math.min(2, Math.sqrt(16_000_000 / (settings.width * height)));
  canvas.width = Math.floor(settings.width * density);
  canvas.height = Math.floor(height * density);
  context.scale(density, density);
  context.clearRect(0, 0, settings.width, height);
  context.save();
  context.beginPath();
  context.roundRect(0, 0, settings.width, height, settings.radius);
  context.clip();
  context.fillStyle = settings.backgroundColor;
  context.fillRect(0, 0, settings.width, height);
  if (settings.background === "image" && !settings.backgroundImageUrl) throw new Error("Choose a background image");
  if (settings.background === "image" && settings.backgroundImageUrl) {
    const image = new Image();
    image.src = settings.backgroundImageUrl;
    await image.decode();
    const scale = Math.max(settings.width / image.width, height / image.height);
    context.drawImage(
      image,
      (settings.width - image.width * scale) / 2,
      (height - image.height * scale) / 2,
      image.width * scale,
      image.height * scale,
    );
  }
  if (settings.background === "grain") {
    let seed = 417;
    context.fillStyle = settings.textColor;
    context.globalAlpha = 0.045;
    for (let i = 0; i < (settings.width * height) / 30; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const px = seed % settings.width;
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      context.fillRect(px, seed % height, 1, 1);
    }
    context.globalAlpha = 1;
  }
  if (settings.background === "ruled" || settings.background === "grid") {
    context.strokeStyle = settings.textColor;
    context.globalAlpha = 0.12;
    context.lineWidth = 0.5;
    for (let py = settings.padding + titleHeight + settings.fontSize + 4; py < height; py += lineHeight) {
      context.beginPath();
      context.moveTo(0, py);
      context.lineTo(settings.width, py);
      context.stroke();
    }
    if (settings.background === "grid")
      for (let px = 0; px < settings.width; px += lineHeight) {
        context.beginPath();
        context.moveTo(px, 0);
        context.lineTo(px, height);
        context.stroke();
      }
    context.globalAlpha = 1;
  }
  context.textBaseline = "alphabetic";
  if (settings.title) {
    context.font = `600 ${settings.fontSize * 1.15}px ${font}`;
    context.fillStyle = settings.textColor;
    context.fillText(settings.title, settings.padding, settings.padding + settings.fontSize, contentWidth);
  }
  context.font = `${settings.fontSize}px ${font}`;
  for (const glyph of glyphs) {
    if (glyph.highlight) {
      context.fillStyle = settings.quoteColor;
      context.globalAlpha = 0.2;
      context.fillRect(glyph.x, glyph.y - settings.fontSize, glyph.width, lineHeight);
      context.globalAlpha = 1;
    }
    context.fillStyle = glyph.quote ? settings.quoteColor : settings.textColor;
    if (glyph.hidden) context.fillRect(glyph.x, glyph.y - settings.fontSize * 0.8, glyph.width, settings.fontSize);
    else context.fillText(glyph.text, glyph.x, glyph.y);
    if (glyph.underline) {
      context.fillRect(glyph.x, glyph.y + 3, glyph.width, 1);
    }
  }
  if (settings.author) {
    context.font = `${settings.fontSize * 0.7}px ${font}`;
    context.fillStyle = settings.textColor;
    context.textAlign = "right";
    context.fillText(settings.author, settings.width - settings.padding, height - settings.padding, contentWidth);
  }
  context.restore();
  return { width: settings.width, height };
}
