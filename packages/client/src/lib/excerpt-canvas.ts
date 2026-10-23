import {
  EXCERPT_HIGHLIGHT_COLORS,
  EXCERPT_HIGHLIGHT_INK,
  EXCERPT_TEXTURES,
  EXCERPT_UNDERLINE_COLORS,
  type ExcerptAppearance,
  type ExcerptMarkColor,
} from "@marinara-engine/shared";

// Rendering ported from the "발췌 스튜디오" extension 1.0.0 (cardMetrics, layoutLines, drawBackground, exportPng).

export type ExcerptMark = {
  start: number;
  end: number;
  type: "highlight" | "underline" | "hide" | "replace";
  color?: ExcerptMarkColor;
  value?: string;
};

/** Keep marks on the unchanged text around an edit; marks inside the edited span are dropped. */
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

/**
 * Highlight/underline/hide marks never overlap: a new mark (or `null` to erase) cuts what it covers and
 * touching marks of the same kind merge, as in the extension. Range replacements are kept separately.
 */
export function applyExcerptMark(
  marks: ExcerptMark[],
  start: number,
  end: number,
  mark: Pick<ExcerptMark, "type" | "color"> | null,
): ExcerptMark[] {
  if (end <= start) return marks;
  const replacements = marks.filter((row) => row.type === "replace");
  const next: ExcerptMark[] = [];
  for (const row of marks) {
    if (row.type === "replace") continue;
    if (row.end <= start || row.start >= end) {
      next.push(row);
      continue;
    }
    if (row.start < start) next.push({ ...row, end: start });
    if (row.end > end) next.push({ ...row, start: end });
  }
  if (mark) next.push({ start, end, ...mark });
  next.sort((a, b) => a.start - b.start);
  const merged: ExcerptMark[] = [];
  for (const row of next) {
    const last = merged[merged.length - 1];
    if (last && last.type === row.type && last.color === row.color && last.end === row.start) last.end = row.end;
    else merged.push({ ...row });
  }
  // Erasing also clears range replacements that touch the selection.
  const keptReplacements = mark ? replacements : replacements.filter((row) => row.end <= start || row.start >= end);
  return [...merged, ...keptReplacements];
}

type Annotated = { ch: string; bs: number; be: number };

/**
 * Apply range replacements, then find→replace rules, remembering which source span every output character
 * came from so marks follow the text (a mark on a replaced word covers the whole replacement).
 */
export function annotateExcerptText(
  text: string,
  marks: ExcerptMark[],
  rules: ExcerptAppearance["replaceRules"],
): Annotated[] {
  const replacements = marks
    .filter((mark) => mark.type === "replace")
    .sort((a, b) => a.start - b.start)
    .filter((mark, index, rows) => index === 0 || mark.start >= rows[index - 1]!.end);
  let chars: Annotated[] = [];
  for (let i = 0; i < text.length;) {
    const replacement = replacements.find((mark) => mark.start === i);
    if (replacement) {
      const value = replacement.value ?? "";
      // UTF-16 units throughout, so shown indexes match the joined string used for layout.
      for (let k = 0; k < value.length; k++) chars.push({ ch: value[k]!, bs: replacement.start, be: replacement.end });
      i = Math.max(i + 1, replacement.end);
    } else {
      chars.push({ ch: text[i]!, bs: i, be: i + 1 });
      i++;
    }
  }
  for (const rule of rules) {
    if (!rule.find) continue;
    const joined = chars.map((c) => c.ch).join("");
    const out: Annotated[] = [];
    for (let i = 0; i < chars.length;) {
      if (joined.startsWith(rule.find, i)) {
        const bs = chars[i]!.bs;
        const be = chars[i + rule.find.length - 1]!.be;
        for (let k = 0; k < rule.replace.length; k++) out.push({ ch: rule.replace[k]!, bs, be });
        i += rule.find.length;
      } else out.push(chars[i++]!);
    }
    chars = out;
  }
  return chars;
}

/** Straight and curly double quotes, as the extension colors dialogue. */
function dialogueMap(text: string) {
  const map = new Uint8Array(text.length);
  let straight = -1;
  let curly = -1;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (straight < 0) straight = i;
      else {
        map.fill(1, straight, i + 1);
        straight = -1;
      }
    } else if (ch === "“") curly = i;
    else if (ch === "”" && curly >= 0) {
      map.fill(1, curly, i + 1);
      curly = -1;
    }
  }
  return map;
}

const CJK_RE = /[ᄀ-ᇿ⺀-〿぀-ヿ㄰-㆏ㇰ-䶿一-鿿ꥠ-꥿가-퟿豈-﫿＀-￯]/;
type Token = { kind: "space" | "cjk" | "word"; text: string; index: number; width: number };
type Line = { tokens: Token[]; width: number; paragraphEnd: boolean };

/** Korean/CJK wrap per character; other scripts wrap at spaces, and only an over-long word is split. */
export function layoutExcerptLines(text: string, maxWidth: number, widthOf: (text: string) => number): Line[] {
  const lines: Line[] = [];
  let cursor = 0;
  for (const paragraph of text.split("\n")) {
    const tokens: Omit<Token, "width">[] = [];
    for (let i = 0; i < paragraph.length;) {
      const ch = paragraph[i]!;
      if (ch === " " || ch === "\t") tokens.push({ kind: "space", text: " ", index: cursor + i++ });
      else if (CJK_RE.test(ch)) tokens.push({ kind: "cjk", text: ch, index: cursor + i++ });
      else {
        let j = i;
        while (j < paragraph.length && !/\s/.test(paragraph[j]!) && !CJK_RE.test(paragraph[j]!)) j++;
        tokens.push({ kind: "word", text: paragraph.slice(i, j), index: cursor + i });
        i = j;
      }
    }
    let line: Token[] = [];
    let lineWidth = 0;
    const pushLine = (paragraphEnd: boolean) => {
      while (line.length && line[line.length - 1]!.kind === "space") lineWidth -= line.pop()!.width;
      lines.push({ tokens: line, width: lineWidth, paragraphEnd });
      line = [];
      lineWidth = 0;
    };
    for (const token of tokens) {
      const entry = { ...token, width: widthOf(token.text) };
      if (entry.kind === "space" && !line.length) continue;
      if (lineWidth + entry.width > maxWidth && line.length && entry.kind !== "space") pushLine(false);
      if (entry.width > maxWidth && entry.kind === "word") {
        let piece = "";
        let pieceStart = entry.index;
        for (let k = 0; k < entry.text.length; k++) {
          const next = piece + entry.text[k];
          if (widthOf(next) > maxWidth && piece) {
            const width = widthOf(piece);
            if (lineWidth + width > maxWidth && line.length) pushLine(false);
            line.push({ kind: "word", text: piece, index: pieceStart, width });
            lineWidth += width;
            pushLine(false);
            piece = entry.text[k]!;
            pieceStart = entry.index + k;
          } else piece = next;
        }
        if (piece) {
          const width = widthOf(piece);
          if (lineWidth + width > maxWidth && line.length) pushLine(false);
          line.push({ kind: "word", text: piece, index: pieceStart, width });
          lineWidth += width;
        }
        continue;
      }
      line.push(entry);
      lineWidth += entry.width;
    }
    pushLine(true);
    cursor += paragraph.length + 1;
  }
  return lines;
}

export function excerptMetrics(appearance: ExcerptAppearance) {
  const fontSize = appearance.fontSize;
  return {
    padding: appearance.padding || Math.round(fontSize * 2.1),
    lineHeight: Math.round(fontSize * appearance.lineHeight),
    titleSize: Math.max(13, Math.round(fontSize * 0.78)),
    authorSize: Math.max(10, Math.round(fontSize * 0.56)),
    gapAboveDivider: Math.round(fontSize * 1.7),
    gapTitle: Math.round(fontSize * 1.05),
    gapAuthor: Math.round(fontSize * 0.45),
  };
}

function rgba(hex: string, alpha: number) {
  const n = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

const grainTiles = new Map<string, HTMLCanvasElement>();
function grainTile(base: string, dark: number, light: number) {
  const key = `${base}|${dark}|${light}`;
  const cached = grainTiles.get(key);
  if (cached) return cached;
  const tile = document.createElement("canvas");
  tile.width = tile.height = 256;
  const g = tile.getContext("2d")!;
  g.fillStyle = base;
  g.fillRect(0, 0, 256, 256);
  // Seeded so the preview and the saved PNG show the same grain.
  let seed = 417;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 2200 && dark > 0; i++) {
    g.fillStyle = `rgba(40,30,10,${(random() * dark).toFixed(3)})`;
    g.fillRect(random() * 256, random() * 256, 1.4, 1.4);
  }
  for (let i = 0; i < 1400 && light > 0; i++) {
    g.fillStyle = `rgba(255,252,240,${(random() * light).toFixed(3)})`;
    g.fillRect(random() * 256, random() * 256, 1.4, 1.4);
  }
  grainTiles.set(key, tile);
  return tile;
}

async function loadImage(url: string) {
  const image = new Image();
  image.src = url;
  await image.decode();
  return image;
}

async function drawBackground(
  context: CanvasRenderingContext2D,
  appearance: ExcerptAppearance,
  width: number,
  height: number,
) {
  const bg = appearance.background;
  if (bg.mode === "image") {
    if (!bg.imageUrl) throw new Error("Choose a background image");
    const image = await loadImage(bg.imageUrl);
    context.fillStyle = "#000";
    context.fillRect(0, 0, width, height);
    const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight);
    const dw = image.naturalWidth * scale;
    const dh = image.naturalHeight * scale;
    context.drawImage(image, (width - dw) / 2, (height - dh) / 2, dw, dh);
    if (bg.bright > 0) {
      context.fillStyle = `rgba(255,255,255,${bg.bright})`;
      context.fillRect(0, 0, width, height);
    }
    if (bg.dim > 0) {
      context.fillStyle = `rgba(0,0,0,${bg.dim})`;
      context.fillRect(0, 0, width, height);
    }
    return;
  }
  const m = excerptMetrics(appearance);
  const texture = bg.mode === "texture" ? EXCERPT_TEXTURES[bg.texture] : null;
  const base = texture ? texture.base : bg.color;
  context.fillStyle = base;
  context.fillRect(0, 0, width, height);
  const ink = rgba(appearance.textColor, 0.08);
  if (bg.pattern === "grain") {
    const pattern = context.createPattern(
      grainTile(base, texture ? texture.grainDark : 0.035, texture ? texture.grainLight : 0.04),
      "repeat",
    );
    if (pattern) {
      context.fillStyle = pattern;
      context.fillRect(0, 0, width, height);
    }
  } else if (bg.pattern === "grid") {
    context.fillStyle = ink;
    for (let x = 0; x <= width; x += 24) context.fillRect(x, 0, 1, height);
    for (let y = 0; y <= height; y += 24) context.fillRect(0, y, width, 1);
  } else if (bg.pattern === "lines") {
    context.fillStyle = ink;
    const offset = Math.round(m.lineHeight / 2 + appearance.fontSize * 0.71);
    for (let y = m.padding + offset; y < height - 4; y += m.lineHeight) context.fillRect(0, y, width, 1);
  }
}

function setLetterSpacing(context: CanvasRenderingContext2D, px: number) {
  // Canvas letterSpacing is missing in older Safari; spacing is then skipped rather than faked.
  if ("letterSpacing" in context)
    (context as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${px}px`;
}

/** Draw the card exactly as it will be saved; returns the CSS-pixel size. */
export async function drawExcerpt(
  canvas: HTMLCanvasElement,
  text: string,
  marks: ExcerptMark[],
  appearance: ExcerptAppearance,
  options: { inheritedFont: string; chatTitle?: string },
) {
  const family =
    appearance.fontFamily ||
    options.inheritedFont ||
    '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
  const m = excerptMetrics(appearance);
  const annotated = annotateExcerptText(text, marks, appearance.replaceRules);
  const shown = annotated.map((c) => c.ch).join("");
  const title = appearance.showTitle ? appearance.titleText.trim() || options.chatTitle?.trim() || "" : "";
  const author = appearance.showAuthor ? appearance.authorText.trim() : "";
  try {
    const sample = `${shown}${title}${author}발췌`;
    await document.fonts.load(`${appearance.fontSize}px ${family}`, sample);
    await document.fonts.load(`700 ${m.titleSize}px ${family}`, sample);
    await document.fonts.ready;
  } catch {
    // A font that cannot load falls back to the browser's next family.
  }
  const width = appearance.cardWidth;
  const contentWidth = width - m.padding * 2;
  if (contentWidth < appearance.fontSize) throw new Error("Card is too narrow for its padding");
  const measure = document.createElement("canvas").getContext("2d")!;
  measure.font = `${appearance.fontSize}px ${family}`;
  setLetterSpacing(measure, appearance.letterSpacing);
  const widthOf = (value: string) => measure.measureText(value).width;
  const lines = layoutExcerptLines(shown, contentWidth, widthOf);
  const bodyHeight = Math.max(1, lines.length) * m.lineHeight;
  let footerHeight = 0;
  if (title || author) {
    footerHeight = m.gapAboveDivider + 1 + m.gapTitle;
    if (title) footerHeight += Math.round(m.titleSize * 1.3);
    if (author) footerHeight += (title ? m.gapAuthor : 0) + Math.round(m.authorSize * 1.4);
  }
  const autoHeight = m.padding * 2 + bodyHeight + footerHeight;
  const height = appearance.heightMode === "fixed" ? Math.max(appearance.cardHeight, autoHeight) : autoHeight;
  if (height > 20000) throw new Error("Excerpt is too long for one image");
  const bodyAreaHeight = height - m.padding * 2 - footerHeight;
  const bodyOffset =
    appearance.heightMode === "fixed" && appearance.vAlign === "center"
      ? Math.max(0, (bodyAreaHeight - bodyHeight) / 2)
      : 0;

  const scale = Math.min(2, Math.sqrt(32_000_000 / (width * height)));
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.scale(scale, scale);
  context.save();
  if (appearance.cornerRadius > 0) {
    context.beginPath();
    context.roundRect(0, 0, width, height, Math.min(appearance.cornerRadius, width / 2, height / 2));
    context.clip();
  }
  await drawBackground(context, appearance, width, height);

  // A shown character carries the first highlight/underline/hide mark over its source span.
  const styleMarks = marks.filter((mark) => mark.type !== "replace");
  const markAt = (index: number) => {
    const source = annotated[index];
    return source ? styleMarks.find((mark) => mark.start < source.be && mark.end > source.bs) : undefined;
  };
  const dialogue = appearance.dialogueEnabled ? dialogueMap(shown) : null;
  const inkFor = (index: number) => {
    if (markAt(index)?.type === "highlight") return EXCERPT_HIGHLIGHT_INK;
    return dialogue?.[index] ? appearance.dialogueColor : appearance.textColor;
  };
  const sameStyle = (a: number, b: number) => markAt(a) === markAt(b) && inkFor(a) === inkFor(b);

  context.font = `${appearance.fontSize}px ${family}`;
  setLetterSpacing(context, appearance.letterSpacing);
  context.textBaseline = "alphabetic";
  const sample = measure.measureText("한Ag");
  const ascent = sample.fontBoundingBoxAscent || appearance.fontSize * 0.82;
  const descent = sample.fontBoundingBoxDescent || appearance.fontSize * 0.22;
  lines.forEach((line, lineIndex) => {
    const baseline = m.padding + bodyOffset + lineIndex * m.lineHeight + (m.lineHeight + ascent - descent) / 2;
    let startX = m.padding;
    let spaceExtra = 0;
    const spaces = line.tokens.filter((token) => token.kind === "space").length;
    if (appearance.align === "center") startX = m.padding + (contentWidth - line.width) / 2;
    else if (appearance.align === "right") startX = m.padding + contentWidth - line.width;
    else if (appearance.align === "justify" && !line.paragraphEnd && spaces > 0)
      spaceExtra = (contentWidth - line.width) / spaces;

    // Pass 1: highlighter and censor blocks, then underlines drawn per continuous run.
    const underlineY = baseline + appearance.fontSize * 0.18 + 3;
    const underlineThickness = Math.max(1.5, appearance.fontSize * 0.1);
    let run: { color: string; x1: number; x2: number } | null = null;
    const flush = () => {
      if (!run) return;
      context.fillStyle = run.color;
      context.fillRect(run.x1, underlineY, run.x2 - run.x1, underlineThickness);
      run = null;
    };
    let x = startX;
    for (const token of line.tokens) {
      const tokenWidth = token.width + (token.kind === "space" ? spaceExtra : 0);
      let cx = x;
      for (let k = 0; k < token.text.length; k++) {
        const charWidth = token.text.length === 1 ? tokenWidth : widthOf(token.text[k]!);
        const mark = markAt(token.index + k);
        if (mark?.type === "hide") {
          flush();
          context.fillStyle = "#111111";
          context.fillRect(cx - 0.5, baseline - ascent - 1, charWidth + 1, ascent + descent + 2);
        } else if (mark?.type === "highlight") {
          flush();
          context.fillStyle = EXCERPT_HIGHLIGHT_COLORS[mark.color ?? "y"];
          context.fillRect(cx - 0.5, baseline - ascent - 3, charWidth + 1, ascent + descent + 6);
        } else if (mark?.type === "underline") {
          const color = EXCERPT_UNDERLINE_COLORS[mark.color ?? "y"];
          if (run && run.color === color) run.x2 = cx + charWidth;
          else {
            flush();
            run = { color, x1: cx, x2: cx + charWidth };
          }
        } else flush();
        cx += charWidth;
      }
      x += tokenWidth;
    }
    flush();

    // Pass 2: text. Censored characters are not drawn; text on a highlighter keeps the dark ink.
    x = startX;
    for (const token of line.tokens) {
      const tokenWidth = token.width + (token.kind === "space" ? spaceExtra : 0);
      if (token.kind !== "space") {
        let uniform = true;
        for (let k = 1; k < token.text.length && uniform; k++) uniform = sameStyle(token.index + k, token.index);
        if (uniform) {
          if (markAt(token.index)?.type !== "hide") {
            context.fillStyle = inkFor(token.index);
            context.fillText(token.text, x, baseline);
          }
        } else {
          let cx = x;
          for (let k = 0; k < token.text.length; k++) {
            if (markAt(token.index + k)?.type !== "hide") {
              context.fillStyle = inkFor(token.index + k);
              context.fillText(token.text[k]!, cx, baseline);
            }
            cx += widthOf(token.text[k]!);
          }
        }
      }
      x += tokenWidth;
    }
  });

  setLetterSpacing(context, 0);
  if (title || author) {
    const footerAlign = appearance.align === "justify" ? "left" : appearance.align;
    const alignX = (w: number) =>
      footerAlign === "center"
        ? m.padding + (contentWidth - w) / 2
        : footerAlign === "right"
          ? m.padding + contentWidth - w
          : m.padding;
    let y = m.padding + bodyAreaHeight + m.gapAboveDivider;
    context.fillStyle = rgba(appearance.textColor, 0.22);
    context.fillRect(m.padding, y, contentWidth, 1);
    y += 1 + m.gapTitle;
    if (title) {
      context.font = `700 ${m.titleSize}px ${family}`;
      let shownTitle = title;
      if (context.measureText(shownTitle).width > contentWidth) {
        while (shownTitle.length > 1 && context.measureText(`${shownTitle}…`).width > contentWidth)
          shownTitle = shownTitle.slice(0, -1);
        shownTitle = `${shownTitle}…`;
      }
      context.fillStyle = appearance.textColor;
      context.fillText(shownTitle, alignX(context.measureText(shownTitle).width), y + m.titleSize);
      y += Math.round(m.titleSize * 1.3) + m.gapAuthor;
    }
    if (author) {
      context.font = `500 ${m.authorSize}px ${family}`;
      setLetterSpacing(context, Math.round(m.authorSize * 0.18));
      context.fillStyle = rgba(appearance.textColor, 0.55);
      context.fillText(author, alignX(context.measureText(author).width), y + m.authorSize);
      setLetterSpacing(context, 0);
    }
  }
  context.restore();
  return { width, height };
}

/** `발췌_YYYYMMDD_HHMMSS.png`, the extension's file name. */
export function excerptFileName(date = new Date()) {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `발췌_${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}.png`;
}
