import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { nativeIntegrationsSchema } from "@marinara-engine/shared";
import { useNativeIntegrations, useSaveNativeIntegrations } from "../../hooks/use-native-integrations";
import { useUploadLibraryCover } from "../../hooks/use-library-cover";
import { drawExcerpt, remapExcerptMarks, type ExcerptMark } from "../../lib/excerpt-canvas";
import { saveExportFile } from "../../lib/file-download";
import { INTEGRATION_BUTTON as button, INTEGRATION_INPUT as field } from "./IntegrationControls";

export function ExcerptStudio({
  initialText = "",
  initialMarks = [],
  onSave,
  saving = false,
}: {
  initialText?: string;
  initialMarks?: ExcerptMark[];
  onSave?: (text: string, marks: ExcerptMark[]) => void;
  saving?: boolean;
}) {
  const { t } = useTranslation();
  const saved = useNativeIntegrations();
  const save = useSaveNativeIntegrations();
  const upload = useUploadLibraryCover();
  const [settings, setSettings] = useState(() => nativeIntegrationsSchema.parse({}).excerpt);
  const [text, setText] = useState(initialText);
  const [marks, setMarks] = useState<ExcerptMark[]>(initialMarks);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [replacement, setReplacement] = useState("");
  const [error, setError] = useState(false);
  const [rendering, setRendering] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const generation = useRef(0);
  const currentRender = useRef<Promise<unknown>>(Promise.resolve());
  const initialized = useRef(false);
  useEffect(() => {
    if (saved.data && !initialized.current) {
      setSettings(saved.data.excerpt);
      initialized.current = true;
    }
  }, [saved.data]);
  useEffect(() => {
    const version = ++generation.current;
    setRendering(true);
    setError(false);
    const timer = setTimeout(() => {
      // Render offscreen first so an old image/font load cannot overwrite a newer preview.
      const buffer = document.createElement("canvas");
      const work = drawExcerpt(buffer, text, marks, settings, getComputedStyle(document.body).fontFamily)
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
      currentRender.current = work;
    }, 120);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [text, marks, settings]);
  const patch = (value: Partial<typeof settings>) => setSettings((old) => ({ ...old, ...value }));
  const mark = (type: ExcerptMark["type"]) => {
    if (selection.end > selection.start)
      setMarks((rows) => [
        ...rows.filter(
          (row) =>
            !(
              row.type === type &&
              (type === "replace"
                ? row.start < selection.end && row.end > selection.start
                : row.start === selection.start && row.end === selection.end)
            ),
        ),
        { ...selection, type, value: type === "replace" ? replacement : undefined },
      ]);
  };
  return (
    <section className="space-y-4" aria-label={t("integrations.excerpt")}>
      <textarea
        className={field}
        rows={7}
        maxLength={20000}
        aria-label={t("integrations.excerptText")}
        value={text}
        onSelect={(e) => setSelection({ start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd })}
        onChange={(e) => {
          setMarks((rows) => remapExcerptMarks(rows, text, e.target.value));
          setText(e.target.value);
        }}
      />
      <div className="flex flex-wrap gap-2">
        {(["highlight", "underline", "hide", "replace"] as const).map((kind) => (
          <button
            className={button}
            type="button"
            key={kind}
            disabled={selection.end <= selection.start}
            onClick={() => mark(kind)}
          >
            {t(`integrations.mark.${kind}`)}
          </button>
        ))}
        <button className={button} type="button" onClick={() => setMarks([])}>
          {t("integrations.clearMarks")}
        </button>
      </div>
      <input
        className={field}
        aria-label={t("integrations.replacement")}
        value={replacement}
        onChange={(e) => setReplacement(e.target.value)}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(["title", "author", "fontFamily"] as const).map((key) => (
          <label key={key} className="text-sm">
            {t(`integrations.excerptFields.${key}`)}
            <input className={field} value={settings[key]} onChange={(e) => patch({ [key]: e.target.value })} />
          </label>
        ))}
        {(
          [
            ["width", 320, 2000, 10],
            ["height", 0, 5000, 10],
            ["padding", 10, 150, 1],
            ["fontSize", 10, 80, 1],
            ["lineHeight", 1, 3, 0.1],
            ["letterSpacing", -2, 10, 0.1],
            ["radius", 0, 100, 1],
          ] as const
        ).map(([key, min, max, step]) => (
          <label key={key} className="text-sm">
            {t(`integrations.excerptFields.${key}`)}
            <input
              className={field}
              type="number"
              min={min}
              max={max}
              step={step}
              value={settings[key]}
              onChange={(e) => {
                const value = Number(e.target.value);
                if (Number.isFinite(value) && value >= min && value <= max) patch({ [key]: value });
              }}
            />
          </label>
        ))}
        {(["backgroundColor", "textColor", "quoteColor"] as const).map((key) => (
          <label key={key} className="flex min-h-11 items-center justify-between gap-2 text-sm">
            {t(`integrations.excerptFields.${key}`)}
            <input
              className="h-11 w-16"
              type="color"
              value={settings[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
          </label>
        ))}
        <label className="text-sm">
          {t("integrations.background")}
          <select
            className={field}
            value={settings.background}
            onChange={(e) => patch({ background: e.target.value as typeof settings.background })}
          >
            {["paper", "grain", "ruled", "grid", "image"].map((key) => (
              <option key={key} value={key}>
                {t(`integrations.backgrounds.${key}`)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {settings.background === "image" && (
        <label className={button}>
          {t("integrations.chooseImage")}
          <input
            className="hidden"
            type="file"
            accept="image/*"
            disabled={upload.isPending}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file)
                try {
                  const result = await upload.mutateAsync(file);
                  patch({ backgroundImageUrl: result.url });
                } catch {
                  toast.error(t("integrations.saveError"));
                }
            }}
          />
        </label>
      )}
      <p className="text-xs text-[var(--muted-foreground)]">{t("integrations.excerptHelp")}</p>
      {error && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {t("integrations.excerptError")}
        </p>
      )}
      <canvas ref={canvas} className="mx-auto block h-auto max-w-full" aria-label={t("integrations.excerptPreview")} />
      <div className="flex flex-wrap gap-2">
        {onSave && (
          <button
            className={button}
            type="button"
            disabled={saving || !text.trim()}
            onClick={() => onSave(text, marks)}
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
              await drawExcerpt(output, text, marks, settings, getComputedStyle(document.body).fontFamily);
              const blob = await new Promise<Blob | null>((resolve) => output.toBlob(resolve, "image/png"));
              if (blob) await saveExportFile(blob, "marinara-excerpt.png");
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
              { ...saved.data!, excerpt: settings },
              {
                onSuccess: () => toast.success(t("integrations.saved")),
                onError: () => toast.error(t("integrations.saveConflict")),
              },
            )
          }
        >
          {t("integrations.saveAppearance")}
        </button>
      </div>
    </section>
  );
}
