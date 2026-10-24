import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  EXCERPT_HIGHLIGHT_COLORS,
  EXCERPT_TEXTURES,
  EXCERPT_UNDERLINE_COLORS,
  excerptAppearanceSchema,
  type ExcerptAppearance,
  type ExcerptMarkColor,
  type ExcerptTexture,
} from "@marinara-engine/shared";
import { useNativeIntegrations, useSaveNativeIntegrations } from "../../hooks/use-native-integrations";
import { useUploadLibraryCover } from "../../hooks/use-library-cover";
import { useFontFamilies } from "../../hooks/use-reader-fonts";
import {
  applyExcerptMark,
  drawExcerpt,
  excerptFileName,
  remapExcerptMarks,
  type ExcerptMark,
} from "../../lib/excerpt-canvas";
import { saveExportFile } from "../../lib/file-download";
import { cn } from "../../lib/utils";
import { INTEGRATION_BUTTON as button, INTEGRATION_INPUT as field } from "./IntegrationControls";

const FONT_FALLBACK = '"Pretendard", "Malgun Gothic", "Apple SD Gothic Neo", sans-serif';
const RIDI_STACK = '"RIDIBatang", "RIDI Batang", "리디바탕", "Noto Serif KR", Batang, serif';
// The extension's source: the official free RIDIBatang build (SIL OFL) on a CDN mirror, about 724 KB, loaded once.
const RIDI_WEBFONT_URL = "https://fastly.jsdelivr.net/gh/projectnoonnu/noonfonts_twelve@1.0/RIDIBatang.woff";
let ridiLoading: Promise<void> | null = null;
function pageHasFamily(family: string) {
  let found = false;
  document.fonts.forEach((face) => {
    if (face.family.replace(/^["']|["']$/g, "") === family) found = true;
  });
  return found;
}
function ensureRidiWebfont() {
  if (pageHasFamily("RIDIBatang")) return Promise.resolve();
  ridiLoading ??= (async () => {
    const response = await fetch(RIDI_WEBFONT_URL, { mode: "cors" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    // A binary FontFace avoids the page's font-src policy, as in the extension.
    const face = new FontFace("RIDIBatang", await response.arrayBuffer());
    await face.load();
    document.fonts.add(face);
  })().catch((error) => {
    ridiLoading = null;
    throw error;
  });
  return ridiLoading;
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="space-y-2 border-t border-[var(--border)] pt-3">
      <legend className="pr-2 text-sm font-semibold">{title}</legend>
      {hint && <p className="text-xs text-[var(--muted-foreground)]">{hint}</p>}
      {children}
    </fieldset>
  );
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          className={cn(button, value === key && "bg-[var(--secondary)] font-semibold")}
          onClick={() => onChange(key)}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function NumberControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  const set = (raw: string) => {
    const next = Number(raw);
    if (Number.isFinite(next) && next >= min && next <= max) onChange(next);
  };
  return (
    <label className="grid grid-cols-[minmax(4.5rem,auto)_1fr_5rem] items-center gap-2 text-sm">
      <span>{label}</span>
      <input
        type="range"
        aria-hidden="true"
        tabIndex={-1}
        className="min-h-11 w-full"
        min={min}
        max={max}
        step={step}
        value={Math.min(max, Math.max(min, value))}
        onChange={(e) => set(e.target.value)}
      />
      <input
        className={field}
        type="number"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => set(e.target.value)}
      />
    </label>
  );
}

export function ExcerptStudio({
  initialText = "",
  initialMarks = [],
  initialAppearance,
  chatTitle = "",
  onSave,
  saving = false,
}: {
  initialText?: string;
  initialMarks?: ExcerptMark[];
  /** Appearance saved with this excerpt; absent uses the default appearance. */
  initialAppearance?: ExcerptAppearance;
  chatTitle?: string;
  onSave?: (text: string, marks: ExcerptMark[], appearance: ExcerptAppearance) => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const saved = useNativeIntegrations();
  const save = useSaveNativeIntegrations();
  const upload = useUploadLibraryCover();
  // The font folder and the registered web fonts.
  const fonts = useFontFamilies();
  const [appearance, setAppearance] = useState<ExcerptAppearance>(
    () => initialAppearance ?? excerptAppearanceSchema.parse({}),
  );
  const [text, setText] = useState(initialText);
  const [marks, setMarks] = useState<ExcerptMark[]>(initialMarks);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [markMode, setMarkMode] = useState<"highlight" | "underline">("highlight");
  const [replacement, setReplacement] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [fontRevision, setFontRevision] = useState(0);
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  const initialized = useRef(!!initialAppearance);
  useEffect(() => {
    if (saved.data && !initialized.current) {
      setAppearance(saved.data.excerpt);
      initialized.current = true;
    }
  }, [saved.data]);
  const inheritedFont = () => getComputedStyle(document.body).fontFamily || FONT_FALLBACK;
  const fontOptions = useMemo(() => {
    const families = [...fonts.folder, ...fonts.web].sort((a, b) => a.localeCompare(b, "ko"));
    // An installed RIDIBatang is used directly; otherwise the web copy is fetched on demand.
    const ridi = families.find((family) => /ridi|리디/i.test(family));
    return {
      ridi: ridi ? `"${ridi}", ${RIDI_STACK}` : RIDI_STACK,
      ridiFamily: ridi ?? "",
      installed: families.filter((family) => family !== ridi),
    };
  }, [fonts]);
  useEffect(() => {
    if (!appearance.fontFamily.includes("RIDIBatang") || appearance.fontFamilyName) return;
    let live = true;
    setStatus(t("excerptStudio.ridiLoading"));
    ensureRidiWebfont()
      .then(() => {
        if (!live) return;
        setStatus("");
        setFontRevision((value) => value + 1);
      })
      .catch(() => live && setStatus(t("excerptStudio.ridiFailed")));
    return () => {
      live = false;
    };
  }, [appearance.fontFamily, appearance.fontFamilyName, t]);
  useEffect(() => {
    const version = ++generation.current;
    setRendering(true);
    setError(false);
    const timer = setTimeout(() => {
      // Render offscreen first so an old image/font load cannot overwrite a newer preview.
      const buffer = document.createElement("canvas");
      drawExcerpt(buffer, text, marks, appearance, { inheritedFont: inheritedFont(), chatTitle })
        .then(() => {
          if (generation.current !== version || !canvas.current) return;
          canvas.current.width = buffer.width;
          canvas.current.height = buffer.height;
          canvas.current.getContext("2d")?.drawImage(buffer, 0, 0);
        })
        .catch(() => {
          if (generation.current === version) setError(true);
        })
        .finally(() => {
          if (generation.current === version) setRendering(false);
        });
    }, 120);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [text, marks, appearance, chatTitle, fontRevision]);

  const patch = (value: Partial<ExcerptAppearance>) => setAppearance((old) => ({ ...old, ...value }));
  const patchBackground = (value: Partial<ExcerptAppearance["background"]>) =>
    setAppearance((old) => ({ ...old, background: { ...old.background, ...value } }));
  const hasSelection = selection.end > selection.start;
  const mark = (value: Pick<ExcerptMark, "type" | "color"> | null) => {
    if (!hasSelection) {
      setStatus(t("excerptStudio.selectFirst"));
      return;
    }
    setStatus("");
    setMarks((rows) => applyExcerptMark(rows, selection.start, selection.end, value));
  };
  const replaceRange = () => {
    if (!hasSelection) {
      setStatus(t("excerptStudio.selectFirst"));
      return;
    }
    setMarks((rows) => [
      ...rows.filter((row) => !(row.type === "replace" && row.start < selection.end && row.end > selection.start)),
      { ...selection, type: "replace", value: replacement },
    ]);
  };
  const colorKeys = Object.keys(EXCERPT_HIGHLIGHT_COLORS) as ExcerptMarkColor[];
  const textureKeys = Object.keys(EXCERPT_TEXTURES) as ExcerptTexture[];
  const selectedFont = appearance.fontFamilyName
    ? appearance.fontFamilyName === fontOptions.ridiFamily
      ? fontOptions.ridi
      : appearance.fontFamily
    : appearance.fontFamily.includes("RIDIBatang")
      ? fontOptions.ridi
      : appearance.fontFamily;

  return (
    <section
      className="grid gap-4 md:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] md:items-start"
      aria-label={t("integrations.excerpt")}
    >
      {/* Preview beside the controls (PC) or pinned above them (mobile), as in the extension. */}
      <div className="sticky -top-4 z-10 space-y-2 bg-[var(--marinara-chat-chrome-panel-bg)] pt-4 pb-2 md:order-2">
        <canvas
          ref={canvas}
          className="mx-auto block h-auto max-h-[38vh] max-w-full object-contain md:max-h-[70vh]"
          aria-label={t("integrations.excerptPreview")}
        />
        {error && (
          <p role="alert" className="text-sm text-[var(--destructive)]">
            {t("integrations.excerptError")}
          </p>
        )}
        {status && (
          <p role="status" className="text-sm text-[var(--muted-foreground)]">
            {status}
          </p>
        )}
      </div>
      <div className="min-w-0 space-y-4 md:order-1">
        <textarea
          className={field}
          rows={5}
          maxLength={20000}
          aria-label={t("integrations.excerptText")}
          value={text}
          onSelect={(e) => setSelection({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
          onChange={(e) => {
            setMarks((rows) => remapExcerptMarks(rows, text, e.target.value));
            setText(e.target.value);
          }}
        />

        <Section title={t("excerptStudio.text")}>
          <NumberControl
            label={t("excerptStudio.fontSize")}
            min={12}
            max={44}
            step={1}
            value={appearance.fontSize}
            onChange={(fontSize) => patch({ fontSize })}
          />
          <label className="block text-sm">
            {t("excerptStudio.font")}
            <select
              className={field}
              value={selectedFont}
              onChange={(e) => {
                const option = e.currentTarget.selectedOptions[0];
                patch({ fontFamily: e.target.value, fontFamilyName: option?.dataset.family ?? "" });
              }}
            >
              <option value="">{t("excerptStudio.pageFont")}</option>
              <option value={fontOptions.ridi} data-family={fontOptions.ridiFamily || undefined}>
                {t("excerptStudio.ridiBatang")}
              </option>
              {fontOptions.installed.length > 0 && (
                <optgroup label={t("excerptStudio.installedFonts")}>
                  {fontOptions.installed.map((family) => (
                    <option key={family} value={`"${family}", ${FONT_FALLBACK}`} data-family={family}>
                      {family}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
          </label>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              {t("excerptStudio.textColor")}
              <input
                className="h-11 w-14"
                type="color"
                value={appearance.textColor}
                onChange={(e) => patch({ textColor: e.target.value })}
              />
            </label>
            <label className="flex min-h-11 items-center gap-2">
              <input
                type="checkbox"
                checked={appearance.dialogueEnabled}
                onChange={(e) => patch({ dialogueEnabled: e.target.checked })}
              />
              {t("excerptStudio.dialogueColor")}
            </label>
            <input
              className="h-11 w-14"
              type="color"
              aria-label={t("excerptStudio.dialogueColorValue")}
              value={appearance.dialogueColor}
              onChange={(e) => patch({ dialogueColor: e.target.value, dialogueEnabled: true })}
            />
          </div>
          <Segmented
            label={t("excerptStudio.align")}
            value={appearance.align}
            onChange={(align) => patch({ align })}
            options={[
              ["left", t("excerptStudio.alignLeft")],
              ["center", t("excerptStudio.alignCenter")],
              ["right", t("excerptStudio.alignRight")],
              ["justify", t("excerptStudio.alignJustify")],
            ]}
          />
          <NumberControl
            label={t("integrations.excerptFields.lineHeight")}
            min={1}
            max={3}
            step={0.05}
            value={appearance.lineHeight}
            onChange={(lineHeight) => patch({ lineHeight })}
          />
          <NumberControl
            label={t("integrations.excerptFields.letterSpacing")}
            min={-2}
            max={10}
            step={0.1}
            value={appearance.letterSpacing}
            onChange={(letterSpacing) => patch({ letterSpacing })}
          />
        </Section>

        <Section title={t("excerptStudio.marks")} hint={t("excerptStudio.marksHint")}>
          <Segmented
            label={t("excerptStudio.markMode")}
            value={markMode}
            onChange={setMarkMode}
            options={[
              ["highlight", t("excerptStudio.highlighter")],
              ["underline", t("excerptStudio.underline")],
            ]}
          />
          <div className="flex flex-wrap gap-2">
            {colorKeys.map((color) => (
              <button
                key={color}
                type="button"
                className="min-h-11 min-w-11 rounded-md border border-[var(--border)]"
                style={
                  markMode === "highlight"
                    ? { background: EXCERPT_HIGHLIGHT_COLORS[color] }
                    : { background: "#ffffff", borderBottom: `5px solid ${EXCERPT_UNDERLINE_COLORS[color]}` }
                }
                aria-label={t(
                  markMode === "highlight" ? "excerptStudio.highlightColor" : "excerptStudio.underlineColor",
                  {
                    color: t(`excerptStudio.colors.${color}`),
                  },
                )}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => mark({ type: markMode, color })}
              />
            ))}
            <button
              type="button"
              className="min-h-11 min-w-11 rounded-md bg-[#111111] px-2 text-white"
              aria-label={t("excerptStudio.censor")}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => mark({ type: "hide" })}
            >
              가
            </button>
            <button
              type="button"
              className={button}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => mark(null)}
            >
              {t("excerptStudio.erase")}
            </button>
            <button className={button} type="button" onClick={() => setMarks([])}>
              {t("integrations.clearMarks")}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className={cn(field, "min-w-0 flex-1")}
              aria-label={t("integrations.replacement")}
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
            <button className={button} type="button" onPointerDown={(e) => e.preventDefault()} onClick={replaceRange}>
              {t("integrations.mark.replace")}
            </button>
          </div>
        </Section>

        <Section title={t("excerptStudio.rules")} hint={t("excerptStudio.rulesHint")}>
          {appearance.replaceRules.map((rule, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                className={cn(field, "min-w-0 flex-1")}
                aria-label={t("excerptStudio.find", { number: index + 1 })}
                placeholder={t("excerptStudio.findPlaceholder")}
                value={rule.find}
                onChange={(e) =>
                  patch({
                    replaceRules: appearance.replaceRules.map((row, i) =>
                      i === index ? { ...row, find: e.target.value } : row,
                    ),
                  })
                }
              />
              <span aria-hidden="true">→</span>
              <input
                className={cn(field, "min-w-0 flex-1")}
                aria-label={t("excerptStudio.replaceWith", { number: index + 1 })}
                placeholder={t("excerptStudio.replacePlaceholder")}
                value={rule.replace}
                onChange={(e) =>
                  patch({
                    replaceRules: appearance.replaceRules.map((row, i) =>
                      i === index ? { ...row, replace: e.target.value } : row,
                    ),
                  })
                }
              />
              <button
                type="button"
                className={button}
                aria-label={t("excerptStudio.removeRule", { number: index + 1 })}
                onClick={() => patch({ replaceRules: appearance.replaceRules.filter((_, i) => i !== index) })}
              >
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            className={button}
            disabled={appearance.replaceRules.length >= 20}
            onClick={() => patch({ replaceRules: [...appearance.replaceRules, { find: "", replace: "" }] })}
          >
            {t("excerptStudio.addRule")}
          </button>
        </Section>

        <Section title={t("excerptStudio.workInfo")}>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="min-h-6 min-w-6"
              aria-label={t("excerptStudio.showTitle")}
              checked={appearance.showTitle}
              onChange={(e) => patch({ showTitle: e.target.checked })}
            />
            <input
              className={cn(field, "min-w-0 flex-1")}
              aria-label={t("excerptStudio.title")}
              placeholder={chatTitle || t("excerptStudio.titlePlaceholder")}
              value={appearance.titleText}
              onChange={(e) => patch({ titleText: e.target.value })}
            />
          </div>
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              className="min-h-6 min-w-6"
              aria-label={t("excerptStudio.showAuthor")}
              checked={appearance.showAuthor}
              onChange={(e) => patch({ showAuthor: e.target.checked })}
            />
            <input
              className={cn(field, "min-w-0 flex-1")}
              aria-label={t("excerptStudio.author")}
              value={appearance.authorText}
              onChange={(e) => patch({ authorText: e.target.value })}
            />
          </div>
        </Section>

        <Section title={t("integrations.background")}>
          <div role="group" aria-label={t("excerptStudio.texture")} className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {textureKeys.map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={appearance.background.mode === "texture" && appearance.background.texture === key}
                className="min-h-11 rounded-md border border-[var(--border)] px-2 text-sm aria-pressed:ring-2 aria-pressed:ring-[var(--primary)]"
                style={{ background: EXCERPT_TEXTURES[key].base, color: EXCERPT_TEXTURES[key].text }}
                onClick={() =>
                  setAppearance((old) => ({
                    ...old,
                    textColor: EXCERPT_TEXTURES[key].text,
                    background: { ...old.background, mode: "texture", texture: key },
                  }))
                }
              >
                {t(`excerptStudio.textures.${key}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <label className="flex min-h-11 items-center gap-2">
              {t("excerptStudio.solid")}
              <input
                className="h-11 w-14"
                type="color"
                value={appearance.background.color}
                onChange={(e) => patchBackground({ mode: "solid", color: e.target.value })}
              />
            </label>
            <label className={button}>
              {t("excerptStudio.loadImage")}
              <input
                className="hidden"
                type="file"
                accept="image/*"
                disabled={upload.isPending}
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  e.target.value = "";
                  if (!file) return;
                  try {
                    const result = await upload.mutateAsync(file);
                    patchBackground({ mode: "image", imageUrl: result.url });
                  } catch {
                    toast.error(t("excerptStudio.imageFailed"));
                  }
                }}
              />
            </label>
          </div>
          <Segmented
            label={t("excerptStudio.pattern")}
            value={appearance.background.pattern}
            onChange={(pattern) =>
              patchBackground({
                pattern,
                ...(appearance.background.mode === "image" ? { mode: "texture" as const } : {}),
              })
            }
            options={[
              ["grain", t("integrations.backgrounds.grain")],
              ["lines", t("integrations.backgrounds.ruled")],
              ["grid", t("integrations.backgrounds.grid")],
              ["none", t("excerptStudio.patternNone")],
            ]}
          />
          {appearance.background.mode === "image" && (
            <>
              <NumberControl
                label={t("excerptStudio.dim")}
                min={0}
                max={70}
                step={1}
                value={Math.round(appearance.background.dim * 100)}
                onChange={(value) => patchBackground({ dim: value / 100 })}
              />
              <NumberControl
                label={t("excerptStudio.bright")}
                min={0}
                max={70}
                step={1}
                value={Math.round(appearance.background.bright * 100)}
                onChange={(value) => patchBackground({ bright: value / 100 })}
              />
            </>
          )}
        </Section>

        <Section title={t("excerptStudio.card")}>
          <NumberControl
            label={t("excerptStudio.width")}
            min={420}
            max={1080}
            step={20}
            value={appearance.cardWidth}
            onChange={(cardWidth) => patch({ cardWidth })}
          />
          <NumberControl
            label={t("excerptStudio.radius")}
            min={0}
            max={60}
            step={2}
            value={appearance.cornerRadius}
            onChange={(cornerRadius) => patch({ cornerRadius })}
          />
          <NumberControl
            label={t("excerptStudio.padding")}
            min={0}
            max={150}
            step={1}
            value={appearance.padding}
            onChange={(padding) => patch({ padding })}
          />
          <Segmented
            label={t("excerptStudio.heightMode")}
            value={appearance.heightMode}
            onChange={(heightMode) => patch({ heightMode })}
            options={[
              ["auto", t("excerptStudio.heightAuto")],
              ["fixed", t("excerptStudio.heightFixed")],
            ]}
          />
          {appearance.heightMode === "fixed" && (
            <>
              <NumberControl
                label={t("excerptStudio.height")}
                min={360}
                max={1800}
                step={20}
                value={appearance.cardHeight}
                onChange={(cardHeight) => patch({ cardHeight })}
              />
              <Segmented
                label={t("excerptStudio.vAlign")}
                value={appearance.vAlign}
                onChange={(vAlign) => patch({ vAlign })}
                options={[
                  ["top", t("excerptStudio.vAlignTop")],
                  ["center", t("excerptStudio.vAlignCenter")],
                ]}
              />
            </>
          )}
        </Section>

        <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-3">
          {onSave && (
            <button
              className={button}
              type="button"
              disabled={saving || !text.trim()}
              onClick={() => onSave(text, marks, appearance)}
            >
              {t("reader.saveExcerpt")}
            </button>
          )}
          <button
            className={button}
            type="button"
            disabled={rendering || error || !text.trim()}
            onClick={async () => {
              setRendering(true);
              try {
                const output = document.createElement("canvas");
                await drawExcerpt(output, text, marks, appearance, { inheritedFont: inheritedFont(), chatTitle });
                const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
                if (blob) await saveExportFile(blob, excerptFileName());
              } catch {
                toast.error(t("integrations.excerptError"));
              } finally {
                setRendering(false);
              }
            }}
          >
            {t("integrations.exportPng")}
          </button>
          <button
            className={button}
            type="button"
            disabled={!saved.data || save.isPending}
            onClick={() =>
              save.mutate(
                { ...saved.data!, excerpt: appearance },
                {
                  onSuccess: () => toast.success(t("integrations.saved")),
                  onError: () => toast.error(t("integrations.saveConflict")),
                },
              )
            }
          >
            {t("excerptStudio.saveDefault")}
          </button>
        </div>
      </div>
    </section>
  );
}
