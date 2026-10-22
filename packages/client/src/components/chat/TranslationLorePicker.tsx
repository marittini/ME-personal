import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLorebooks, useLorebookEntries } from "../../hooks/use-lorebooks";
import type { NativeIntegrations } from "@marinara-engine/shared";
import { INTEGRATION_INPUT as field } from "./IntegrationControls";
type Refs = NativeIntegrations["translation"]["defaults"]["loreEntries"];
export function TranslationLorePicker({ value, onChange }: { value: Refs; onChange: (value: Refs) => void }) {
  const { t } = useTranslation();
  const [book, setBook] = useState("");
  const books = useLorebooks();
  const entries = useLorebookEntries(book || null);
  return (
    <details>
      <summary className="min-h-11 cursor-pointer py-3 text-sm">
        {t("integrations.translationLore", { count: value.length })}
      </summary>
      <select
        className={field}
        aria-label={t("integrations.lorebook")}
        value={book}
        onChange={(e) => setBook(e.target.value)}
      >
        <option value="">{t("integrations.selectLorebook")}</option>
        {books.data?.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
      {entries.isError && <p role="alert">{t("integrations.loadError")}</p>}
      <div className="max-h-64 overflow-y-auto">
        {entries.data?.map((entry) => (
          <label key={entry.id} className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={value.some((ref) => ref.book === book && ref.id === entry.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...value, { book, id: entry.id }]
                    : value.filter((ref) => ref.id !== entry.id || ref.book !== book),
                )
              }
            />
            {entry.name || entry.keys.join(", ") || t("integrations.unnamedEntry")}
          </label>
        ))}
      </div>
    </details>
  );
}
