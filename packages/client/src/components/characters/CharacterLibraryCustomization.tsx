import { LibraryCustomizationFields } from "./LibraryCustomizationFields";
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { useChats } from "../../hooks/use-chats";
import { libraryChatGroupKey } from "../../lib/library-chat-group";

const CoverEditor = lazy(() =>
  import("../chat/LibraryCoverEditor").then((module) => ({ default: module.LibraryCoverEditor })),
);

/** Keep customization in its owner's editor; existing work/cast cover keys stay unchanged. */
export function CharacterLibraryCustomization({
  characterId,
  characterName,
  onDirtyChange,
}: {
  characterId: string;
  characterName: string;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [dirty, setDirty] = useState(false);
  const close = async () => {
    if (
      dirty &&
      !(await showConfirmDialog({
        title: t("reader.cancel"),
        message: t("libraryCustomization.discardDraft"),
        confirmLabel: t("reader.cancel"),
        cancelLabel: t("libraryCustomization.keepEditing"),
      }))
    )
      return;
    setDirty(false);
    onDirtyChange?.(false);
    setOpen(false);
  };
  return (
    <details
      className="border-t border-[var(--border)] pt-3"
      open={open}
      onToggle={(event) => {
        if (event.currentTarget.open) setOpen(true);
      }}
      data-component="CharacterLibraryCustomization"
    >
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
        <CharacterLibraryCovers
          characterId={characterId}
          characterName={characterName}
          onClose={() => void close()}
          onDirtyChange={(value) => {
            setDirty(value);
            onDirtyChange?.(value);
          }}
        />
      )}
    </details>
  );
}

function CharacterLibraryCovers({
  characterId,
  characterName,
  onClose,
  onDirtyChange,
}: {
  characterId: string;
  characterName: string;
  onClose: () => void;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const chats = useChats();
  const soloId = libraryChatGroupKey({ id: "", characterIds: [characterId] });
  const [coverDirty, setCoverDirty] = useState(false);
  const [labelsDirty, setLabelsDirty] = useState(false);
  const dirty = coverDirty || labelsDirty;
  const changeCoverDirty = (value: boolean) => {
    setCoverDirty(value);
    onDirtyChange(value || labelsDirty);
  };
  const changeLabelsDirty = (value: boolean) => {
    setLabelsDirty(value);
    onDirtyChange(value || coverDirty);
  };
  const [selected, setSelected] = useState(soloId);
  const works = useMemo(() => {
    const grouped = new Map<string, string>();
    grouped.set(soloId, t("libraryCustomization.solo", { name: characterName }));
    // The most recent room names distinguish group works without fetching message history.
    for (const chat of [...(chats.data ?? [])].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))) {
      if (!chat.characterIds.includes(characterId)) continue;
      const key = libraryChatGroupKey(chat);
      if (!grouped.has(key)) grouped.set(key, chat.name);
    }
    return grouped;
  }, [chats.data, characterId, characterName, soloId, t]);
  const workId = works.has(selected) ? selected : soloId;
  return (
    <div className="space-y-3 pt-3">
      <p className="text-sm text-[var(--muted-foreground)]">{t("libraryCustomization.help")}</p>
      {chats.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-2 text-sm">
          <p>{t("libraryCustomization.loadError")}</p>
          <button
            type="button"
            className="min-h-11 rounded-md border border-[var(--border)] px-3"
            onClick={() => void chats.refetch()}
          >
            {t("integrations.reload")}
          </button>
        </div>
      ) : chats.isPending ? (
        <p role="status" className="text-sm">
          {t("libraryCover.loading")}
        </p>
      ) : null}
      <label className="block text-sm">
        {t("libraryCustomization.work")}
        <select
          className="mt-2 min-h-11 w-full min-w-0 rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-[var(--foreground)]"
          value={workId}
          onChange={async (event) => {
            const next = event.target.value;
            if (
              dirty &&
              !(await showConfirmDialog({
                title: t("libraryCustomization.switchWork"),
                message: t("libraryCustomization.discardDraft"),
                confirmLabel: t("libraryCustomization.switchWork"),
                cancelLabel: t("reader.cancel"),
              }))
            )
              return;
            setCoverDirty(false);
            setLabelsDirty(false);
            onDirtyChange(false);
            setSelected(next);
          }}
        >
          {[...works].map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <LibraryCustomizationFields key={`labels:${workId}`} workId={workId} onDirtyChange={changeLabelsDirty} />
      <Suspense fallback={<p role="status">{t("libraryCover.loading")}</p>}>
        <CoverEditor key={workId} workId={workId} onClose={onClose} onDirtyChange={changeCoverDirty} />
      </Suspense>
    </div>
  );
}
