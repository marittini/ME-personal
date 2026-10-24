import { useTranslation } from "react-i18next";
import { useUIStore } from "../../stores/ui.store";
import { READER_PAGES, effectiveReaderPage, readerPageTheme, type ReaderPage } from "../../lib/reader-preferences";

/** Picks one of the four page colors; it is the whole app's theme (shared by reading settings and Settings). */
export function setReaderPage(next: ReaderPage) {
  useUIStore.setState((state) => ({
    readerPreferences: { ...state.readerPreferences, shared: { ...state.readerPreferences.shared, page: next } },
  }));
  useUIStore.getState().setTheme(readerPageTheme(next));
}

export function ReaderPagePicker({ label, id }: { label: string; id?: string }) {
  const { t } = useTranslation();
  const stored = useUIStore((state) => state.readerPreferences.shared.page);
  const theme = useUIStore((state) => state.theme);
  const page = effectiveReaderPage(stored, theme);
  return (
    <div id={id} role="radiogroup" aria-label={label} className="flex flex-wrap gap-2" data-reader-page-picker="">
      {READER_PAGES.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={page === value}
          aria-label={t(`reader.pages.${value}`)}
          title={t(`reader.pages.${value}`)}
          data-reader-page-swatch={value}
          className="inline-flex min-h-11 min-w-14 items-center justify-center rounded-full border border-[var(--border)] px-3 text-xs aria-checked:ring-2 aria-checked:ring-[var(--primary)] aria-checked:ring-offset-2 aria-checked:ring-offset-[var(--background)]"
          onClick={() => setReaderPage(value)}
        >
          {t(`reader.pages.${value}`)}
        </button>
      ))}
    </div>
  );
}
