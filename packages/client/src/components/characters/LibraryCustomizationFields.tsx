import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { libraryCustomizationSchema, type LibraryCustomization } from "@marinara-engine/shared";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useUIStore } from "../../stores/ui.store";
import { INTEGRATION_INPUT as field, INTEGRATION_BUTTON as button } from "../chat/IntegrationControls";
export function LibraryCustomizationFields({
  workId,
  onDirtyChange,
}: {
  workId: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const saved = useUIStore((s) => s.libraryCustomizations[workId]);
  const [draft, setDraft] = useState<LibraryCustomization>(() => saved ?? libraryCustomizationSchema.parse({}));
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) setDraft(saved ?? libraryCustomizationSchema.parse({}));
  }, [saved, dirty]);
  const patch = (value: Partial<LibraryCustomization>) => {
    setDraft((old) => ({ ...old, ...value }));
    setDirty(true);
    onDirtyChange(true);
  };
  const save = () => {
    useUIStore.setState((s) => ({
      libraryCustomizations: { ...s.libraryCustomizations, [workId]: libraryCustomizationSchema.parse(draft) },
    }));
    setDirty(false);
    onDirtyChange(false);
  };
  return (
    <section className="space-y-3 border-b border-[var(--border)] py-4" aria-label={t("libraryCustomization.labels")}>
      {(["title", "displayName", "description"] as const).map((key) => (
        <label className="block text-sm" key={key}>
          {t(`libraryCustomization.fields.${key}`)}
          {key === "description" ? (
            <textarea
              className={field}
              rows={4}
              maxLength={8000}
              value={draft[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
          ) : (
            <input
              className={field}
              maxLength={key === "title" ? 300 : 200}
              value={draft[key]}
              onChange={(e) => patch({ [key]: e.target.value })}
            />
          )}
        </label>
      ))}
      <p className="text-xs text-[var(--muted-foreground)]">{t("libraryCustomization.emptyFallback")}</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!dirty} onClick={save}>
          {t("libraryCustomization.saveLabels")}
        </button>
        <button
          type="button"
          className={button}
          disabled={!dirty}
          onClick={() => {
            setDraft(saved ?? libraryCustomizationSchema.parse({}));
            setDirty(false);
            onDirtyChange(false);
          }}
        >
          {t("reader.cancel")}
        </button>
        <button
          type="button"
          className={button}
          onClick={async () => {
            if (
              !(await showConfirmDialog({
                title: t("libraryCustomization.resetLabels"),
                message: t("libraryCustomization.resetConfirm"),
                confirmLabel: t("libraryCustomization.resetLabels"),
                cancelLabel: t("reader.cancel"),
              }))
            )
              return;
            const empty = libraryCustomizationSchema.parse({});
            setDraft(empty);
            useUIStore.setState((s) => {
              const next = { ...s.libraryCustomizations };
              delete next[workId];
              return { libraryCustomizations: next };
            });
            setDirty(false);
            onDirtyChange(false);
          }}
        >
          {t("libraryCustomization.resetLabels")}
        </button>
      </div>
    </section>
  );
}
