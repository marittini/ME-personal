import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ImageGenerationDefaultsProfile } from "@marinara-engine/shared";
import { useReadNovelAiMetadata } from "../../hooks/use-native-integrations";
import { useUploadConnectionImage } from "../../hooks/use-connections";

export function NovelAiMetadataImport({
  connectionId,
  profile,
  model,
  onApply,
}: {
  connectionId: string | null;
  profile: ImageGenerationDefaultsProfile;
  model: string;
  onApply: (profile: ImageGenerationDefaultsProfile, model: string) => void;
}) {
  const { t } = useTranslation();
  const read = useReadNovelAiMetadata();
  const upload = useUploadConnectionImage();
  const file = useRef<File | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [chosenModel, setChosenModel] = useState("");
  const input = "min-h-11 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm";
  return (
    <section className="space-y-3 border-b border-[var(--border)] py-4">
      <h3 className="text-sm font-semibold">{t("integrations.metadata")}</h3>
      <label className="block text-sm">
        {t("integrations.chooseImage")}
        <input
          type="file"
          accept="image/png,image/webp"
          className="mt-2 block max-w-full"
          disabled={read.isPending}
          onChange={async (event) => {
            const next = event.target.files?.[0];
            event.target.value = "";
            if (!next) return;
            read.reset();
            file.current = next;
            setSelected([]);
            try {
              const result = await read.mutateAsync(next);
              setChosenModel(String(result.values.model ?? ""));
            } catch {
              toast.error(t("integrations.metadataError"));
            }
          }}
        />
      </label>
      {read.isPending && <p role="status">{t("integrations.loading")}</p>}
      {read.data && (
        <>
          <p className="text-xs text-[var(--muted-foreground)]">{read.data.source}</p>
          {Object.entries(read.data.values)
            .filter(([key]) => key !== "model")
            .map(([key, value]) => (
              <label key={key} className="block text-sm">
                <span className="flex min-h-11 items-center gap-2">
                  <input
                    type="checkbox"
                    checked={selected.includes(key)}
                    onChange={(event) =>
                      setSelected(event.target.checked ? [...selected, key] : selected.filter((item) => item !== key))
                    }
                  />
                  {t(`integrations.metadataFields.${key}`)}
                </span>
                <span className="block break-words rounded bg-[var(--secondary)] p-2 text-xs">
                  {String(profile.novelai?.[key as keyof NonNullable<typeof profile.novelai>] ?? "")} → {String(value)}
                </span>
              </label>
            ))}
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.includes("model")}
              onChange={(event) =>
                setSelected(event.target.checked ? [...selected, "model"] : selected.filter((key) => key !== "model"))
              }
            />
            {t("integrations.model")}
            <select className={input} value={chosenModel} onChange={(event) => setChosenModel(event.target.value)}>
              <option value="">{t("integrations.noModelGuess")}</option>
              {read.data.modelOptions.map((id) => (
                <option key={id}>{id}</option>
              ))}
            </select>
          </label>
          <p className="text-xs text-[var(--muted-foreground)]">{t("integrations.seedReset")}</p>
          {read.data.omitted.length > 0 && (
            <p role="status">{t("integrations.omitted", { fields: read.data.omitted.join(", ") })}</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={input}
              disabled={!selected.length || (selected.includes("model") && !chosenModel)}
              onClick={() => {
                const fields = Object.fromEntries(
                  Object.entries(read.data!.values).filter(([key]) => key !== "model" && selected.includes(key)),
                );
                onApply(
                  { ...profile, seed: -1, novelai: { ...profile.novelai!, ...fields, undesiredContentPreset: 0 } },
                  selected.includes("model") ? chosenModel : model,
                );
                toast.success(t("integrations.appliedDraft"));
              }}
            >
              {t("integrations.applySelected")}
            </button>
            <button
              type="button"
              className={input}
              disabled={!connectionId || upload.isPending}
              onClick={async () => {
                if (!file.current || !connectionId) return;
                try {
                  const dataUrl = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result));
                    reader.onerror = reject;
                    reader.readAsDataURL(file.current!);
                  });
                  await upload.mutateAsync({ id: connectionId, image: dataUrl });
                  toast.success(t("integrations.thumbnailSaved"));
                } catch {
                  toast.error(t("integrations.saveError"));
                }
              }}
            >
              {t("integrations.useThumbnail")}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
