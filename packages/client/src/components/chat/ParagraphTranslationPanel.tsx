import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useTranslateParagraph, useSaveParagraphTranslation } from "../../hooks/use-paragraph-translation";
import { INTEGRATION_BUTTON as button, INTEGRATION_INPUT as field } from "./IntegrationControls";
import { hideTTSAudioCues } from "../../lib/tts-audio-tags";

export function ParagraphTranslationPanel({
  chatId,
  messageId,
  text,
  swipeIndex = 0,
  translation,
}: {
  chatId: string;
  messageId: string;
  text: string;
  swipeIndex?: number;
  translation?: string;
}) {
  const { t } = useTranslation();
  const translate = useTranslateParagraph(chatId);
  const save = useSaveParagraphTranslation(chatId);
  const source = text.split(/\n{2,}/);
  const translated = translation?.split(/\n{2,}/);
  const initial = () => (translated?.length === source.length ? translated : source.map(() => ""));
  const [values, setValues] = useState(initial);
  const [busy, setBusy] = useState<number | null>(null);
  const version = useRef(0);
  useEffect(() => {
    version.current++;
    const count = text.split(/\n{2,}/).length;
    const rows = translation?.split(/\n{2,}/);
    setValues(rows?.length === count ? rows : Array.from({ length: count }, () => ""));
    setBusy(null);
    return () => {
      version.current++;
    };
  }, [chatId, messageId, text, swipeIndex, translation]);
  return (
    <div className="space-y-4 py-3">
      {source.map((paragraph, index) => (
        <div key={index} className="space-y-2 border-b border-[var(--border)] pb-3">
          <p className="whitespace-pre-wrap break-words text-sm">{hideTTSAudioCues(paragraph)}</p>
          <textarea
            aria-label={t("integrations.paragraphNumber", { number: index + 1 })}
            rows={3}
            className={field}
            value={values[index] ?? ""}
            onChange={(e) => setValues((rows) => rows.map((value, i) => (i === index ? e.target.value : value)))}
          />
          <button
            type="button"
            className={button}
            disabled={busy !== null || save.isPending}
            onClick={async () => {
              const captured = version.current;
              setBusy(index);
              try {
                const result = await translate.mutateAsync(paragraph);
                if (version.current === captured)
                  setValues((rows) => rows.map((value, i) => (i === index ? result.translatedText : value)));
              } catch {
                toast.error(t("integrations.translationError"));
              } finally {
                if (version.current === captured) setBusy(null);
              }
            }}
          >
            {t(busy === index ? "integrations.translating" : "integrations.translateParagraph")}
          </button>
        </div>
      ))}
      <button
        type="button"
        className={button}
        disabled={busy !== null || save.isPending || values.some((value) => !value.trim())}
        onClick={() =>
          save.mutate(
            { source: text, messageId, swipeIndex, paragraphs: values },
            {
              onSuccess: () => toast.success(t("integrations.saved")),
              onError: () => toast.error(t("integrations.translationSourceChanged")),
            },
          )
        }
      >
        {t("integrations.saveTranslation")}
      </button>
    </div>
  );
}
