import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { personaLibraryKey } from "../../hooks/use-library-card-display";
import { LibraryCustomizationFields } from "../characters/LibraryCustomizationFields";

/** Library display labels for a persona, kept in its own editor like the character's 서재 꾸미기. */
export function PersonaLibraryCustomization({
  personaId,
  onDirtyChange,
}: {
  personaId: string;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const dirty = useRef(false);
  const close = async () => {
    if (
      dirty.current &&
      !(await showConfirmDialog({
        title: t("reader.cancel"),
        message: t("libraryCustomization.discardDraft"),
        confirmLabel: t("reader.cancel"),
        cancelLabel: t("libraryCustomization.keepEditing"),
      }))
    )
      return;
    dirty.current = false;
    onDirtyChange(false);
    setOpen(false);
  };
  return (
    <details className="border-t border-[var(--border)] pt-3" open={open} data-component="PersonaLibraryCustomization">
      <summary
        className="flex min-h-11 cursor-pointer items-center text-sm font-semibold"
        onClick={(event) => {
          event.preventDefault();
          if (open) void close();
          else setOpen(true);
        }}
      >
        {t("libraryCustomization.title")}
      </summary>
      {open && (
        <LibraryCustomizationFields
          variant="persona"
          workId={personaLibraryKey(personaId)}
          onDirtyChange={(value) => {
            dirty.current = value;
            onDirtyChange(value);
          }}
        />
      )}
    </details>
  );
}
