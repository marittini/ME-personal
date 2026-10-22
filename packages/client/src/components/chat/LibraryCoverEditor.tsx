import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { LibraryCover, SourceRectAvatarCrop } from "@marinara-engine/shared";
import { toast } from "sonner";
import { getAvatarCropStyle } from "../../lib/utils";
import { useUploadLibraryCover } from "../../hooks/use-library-cover";
import { useUIStore } from "../../stores/ui.store";

/** A 2:3 crop preview uses the same source rectangle as every rendered cover. */
export function LibraryCoverEditor({ workId, onClose }: { workId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const saved = useUIStore((state) => state.libraryCovers[workId]);
  const [draft, setDraft] = useState<LibraryCover | null>(saved ?? null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(0.5);
  const [y, setY] = useState(0.5);
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadLibraryCover();
  // Late uploads must not update an editor the user closed or navigated away from.
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const initialize = (width: number, height: number) => {
    setSize({ width, height });
    const crop = draft?.crop;
    if (crop && "srcWidth" in crop) {
      const fullWidth = Math.min(1, (height * 2) / (width * 3));
      setZoom(Math.max(1, fullWidth / crop.srcWidth));
      setX(crop.srcWidth < 1 ? crop.srcX / (1 - crop.srcWidth) : 0.5);
      setY(crop.srcHeight < 1 ? crop.srcY / (1 - crop.srcHeight) : 0.5);
    }
  };
  let crop: SourceRectAvatarCrop | null = null;
  if (size) {
    const width = Math.min(1, (size.height * 2) / (size.width * 3)) / zoom;
    const height = (width * size.width * 3) / (size.height * 2);
    crop = { srcX: (1 - width) * x, srcY: (1 - height) * y, srcWidth: width, srcHeight: height };
  }
  const save = () => {
    if (!draft || !crop) return;
    useUIStore.setState((state) => ({ libraryCovers: { ...state.libraryCovers, [workId]: { ...draft, crop } } }));
    onClose();
  };
  const button = "min-h-11 rounded-md border border-[var(--border)] px-4 text-sm disabled:opacity-40";
  return (
    <section className="space-y-4 border-b border-[var(--border)] py-5" aria-label={t("libraryCover.edit")}>
      <p className="text-sm text-[var(--muted-foreground)]">{t("libraryCover.help")}</p>
      <input
        ref={input}
        className="hidden"
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
        aria-label={t("libraryCover.upload")}
        onChange={async (event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          try {
            const result = await upload.mutateAsync(file);
            if (!mounted.current) return;
            setDraft(result);
            setSize(null);
            setZoom(1);
            setX(0.5);
            setY(0.5);
          } catch {
            if (mounted.current) toast.error(t("libraryCover.uploadFailed"));
          }
        }}
      />
      <button type="button" className={button} disabled={upload.isPending} onClick={() => input.current?.click()}>
        {t(upload.isPending ? "libraryCover.uploading" : "libraryCover.upload")}
      </button>
      {draft && (
        <>
          <div className="relative mx-auto aspect-[2/3] w-44 overflow-hidden rounded-md bg-[var(--secondary)]">
            <img
              key={draft.url}
              src={draft.url}
              alt={t("libraryCover.preview")}
              className="h-full w-full object-cover"
              style={getAvatarCropStyle(crop)}
              onLoad={(event) => initialize(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)}
              onError={() => {
                setSize(null);
                toast.error(t("libraryCover.uploadFailed"));
              }}
            />
          </div>
          {(
            [
              ["zoom", zoom, 1, 4, setZoom],
              ["horizontal", x, 0, 1, setX],
              ["vertical", y, 0, 1, setY],
            ] as const
          ).map(([key, value, min, max, setter]) => (
            <label key={key} className="flex min-h-11 items-center gap-4 text-sm">
              <span className="w-20 shrink-0">{t(`libraryCover.${key}`)}</span>
              <input
                type="range"
                className="min-h-11 min-w-0 flex-1"
                min={min}
                max={max}
                step={0.01}
                value={value}
                disabled={!size || upload.isPending}
                onChange={(event) => setter(Number(event.target.value))}
              />
            </label>
          ))}
        </>
      )}
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!size || upload.isPending} onClick={save}>
          {t("reader.save")}
        </button>
        <button type="button" className={button} onClick={onClose}>
          {t("reader.cancel")}
        </button>
        {saved && (
          <button
            type="button"
            className={button}
            disabled={upload.isPending}
            onClick={() => {
              useUIStore.setState((state) => {
                const covers = { ...state.libraryCovers };
                delete covers[workId];
                return { libraryCovers: covers };
              });
              onClose();
            }}
          >
            {t("libraryCover.remove")}
          </button>
        )}
      </div>
    </section>
  );
}
