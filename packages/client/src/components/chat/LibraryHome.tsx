import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Clock3,
  Home,
  LibraryBig,
  MessageCircle,
  Plus,
  Search,
  Settings,
  ScrollText,
  PencilLine,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { type AvatarCrop, type Chat } from "@marinara-engine/shared";
import { useCharacterSummaries } from "../../hooks/use-characters";
import { useChats, useCreateChat, useDeleteChat, useUpdateChat } from "../../hooks/use-chats";
import { useBackDismiss } from "../../hooks/use-back-dismiss";
import { showChoiceDialog, showConfirmDialog, showPromptDialog } from "../../lib/app-dialogs";
import { imagePreviewUrl } from "../../lib/image-preview-url";
import { useHomeFeed } from "../../hooks/use-home-feed";
import { cn, getAvatarCropStyle } from "../../lib/utils";
import { libraryChatGroupKey } from "../../lib/library-chat-group";
import { useChatStore } from "../../stores/chat.store";
import { useUIStore } from "../../stores/ui.store";
import { useDialogStore } from "../../stores/dialog.store";

const LibrarySettingsHome = lazy(() =>
  import("./LibrarySettingsHome").then((module) => ({ default: module.LibrarySettingsHome })),
);

type LibrarySection = "home" | "library" | "record" | "settings";

type VirtualWork = {
  id: string;
  title: string;
  author: string;
  coverUrl: string | null;
  coverCrop: AvatarCrop | null;
  chats: Chat[];
  activeChat: Chat;
  lastMessageAt: string | null;
  unreadCount: number;
  preview: string | null;
};

function workTimestamp(chat: Chat): number {
  return Date.parse(chat.lastMessageAt ?? chat.updatedAt ?? chat.createdAt) || 0;
}

function cleanPreview(value: string | null | undefined): string | null {
  const text = value?.replace(/\s+/gu, " ").trim();
  return text ? text.slice(0, 150) : null;
}

function formatReadTime(value: string | null, locale: string, fallback: string): string {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return fallback;
  return new Intl.DateTimeFormat(locale, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(
    parsed,
  );
}

function WorkCover({ work, className }: { work: VirtualWork; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <span
      className={cn(
        "relative block overflow-hidden rounded-[0.35rem] border border-[var(--border)] bg-[var(--secondary)] shadow-[0_14px_32px_-24px_rgba(0,0,0,0.6)]",
        className,
      )}
      aria-hidden="true"
    >
      {work.coverUrl && failedUrl !== work.coverUrl ? (
        <span className="absolute inset-0">
          <img
            src={work.coverUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
            style={getAvatarCropStyle(work.coverCrop)}
            onError={() => setFailedUrl(work.coverUrl)}
          />
        </span>
      ) : (
        <span className="flex h-full flex-col justify-between p-3">
          <span className="h-px w-8 bg-[var(--primary)]" />
          <span className="line-clamp-4 text-sm font-semibold leading-snug text-[var(--foreground)]">{work.title}</span>
          <span className="truncate text-[0.62rem] tracking-[0.08em] text-[var(--muted-foreground)]">
            {work.author}
          </span>
        </span>
      )}
    </span>
  );
}

export function LibraryHome() {
  const { t, i18n } = useTranslation();
  const navigation = useUIStore((state) => state.libraryNavigation);
  const positions = useUIStore((state) => state.readerPositions);
  const covers = useUIStore((state) => state.libraryCovers);
  const overlayOpen = useUIStore((state) => state.rightPanelOpen || !!state.modal || state.hasAnyDetailOpen());
  const dialogOpen = useDialogStore((state) => !!state.dialog);
  const { section, query } = navigation;
  const setSection = (value: LibrarySection) =>
    useUIStore.setState((state) => ({ libraryNavigation: { ...state.libraryNavigation, section: value } }));
  const setQuery = (value: string) =>
    useUIStore.setState((state) => ({ libraryNavigation: { ...state.libraryNavigation, query: value } }));
  const setSelectedWork = (value: VirtualWork | null) =>
    useUIStore.setState((state) => ({
      libraryNavigation: { ...state.libraryNavigation, selectedWorkId: value?.id ?? null },
    }));
  const deleteChat = useDeleteChat();
  const createChat = useCreateChat();
  const updateChat = useUpdateChat();
  const chats = useChats();
  const feed = useHomeFeed();
  const unreadCounts = useChatStore((state) => state.unreadCounts);
  const generatingChats = useChatStore((state) => state.abortControllers);
  const setActiveChatId = useChatStore((state) => state.setActiveChatId);
  const characterIds = useMemo(
    () => Array.from(new Set((chats.data ?? []).flatMap((chat) => chat.characterIds))),
    [chats.data],
  );
  const characters = useCharacterSummaries(characterIds);

  const works = useMemo(() => {
    const characterById = new Map((characters.data ?? []).map((character) => [character.id, character]));
    const previewByChat = new Map(
      (feed.data?.recentChats ?? []).map((entry) => [entry.chat.id, cleanPreview(entry.latestMessage?.content)]),
    );
    const groups = new Map<string, Chat[]>();
    for (const chat of chats.data ?? []) {
      const key = libraryChatGroupKey(chat);
      const group = groups.get(key);
      if (group) group.push(chat);
      else groups.set(key, [chat]);
    }

    return Array.from(groups, ([id, groupedChats]): VirtualWork => {
      const ordered = [...groupedChats].sort((a, b) => workTimestamp(b) - workTimestamp(a));
      const activeChat = ordered[0];
      const primaryCharacter = activeChat.characterIds
        .map((characterId) => characterById.get(characterId))
        .find(Boolean);
      return {
        id,
        title:
          activeChat.characterIds
            .map((characterId) => characterById.get(characterId)?.name)
            .filter(Boolean)
            .join(" · ") || activeChat.name,
        author: primaryCharacter?.name ?? t("libraryShell.unknownAuthor"),
        coverUrl: covers[id]?.url ? imagePreviewUrl(covers[id].url) : null,
        coverCrop: covers[id]?.crop ?? null,
        chats: ordered,
        activeChat,
        lastMessageAt: activeChat.lastMessageAt ?? activeChat.updatedAt,
        unreadCount: ordered.reduce((total, chat) => total + (unreadCounts.get(chat.id) ?? 0), 0),
        preview: ordered.map((chat) => previewByChat.get(chat.id)).find(Boolean) ?? null,
      };
    }).sort((a, b) => workTimestamp(b.activeChat) - workTimestamp(a.activeChat));
  }, [characters.data, chats.data, feed.data?.recentChats, t, unreadCounts, covers]);

  const selectedWork = works.find((work) => work.id === navigation.selectedWorkId) ?? null;
  useBackDismiss(!!selectedWork && !overlayOpen && !dialogOpen, () => setSelectedWork(null));
  const readWorks = useMemo(
    () =>
      works
        .flatMap((work) => {
          const readChats = work.chats
            .filter((chat) => positions[chat.id])
            .sort((a, b) => positions[b.id].updatedAt.localeCompare(positions[a.id].updatedAt));
          return readChats.length
            ? [{ ...work, activeChat: readChats[0], lastMessageAt: positions[readChats[0].id].updatedAt }]
            : [];
        })
        .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt)),
    [works, positions],
  );
  const removeRecord = async (chat: Chat) => {
    if (useChatStore.getState().abortControllers.has(chat.id)) {
      toast.error(t("reader.stopBeforeDelete"));
      return;
    }
    if (
      !(await showConfirmDialog({
        title: t("reader.delete"),
        message: t("reader.deleteConfirm", { name: chat.name }),
        confirmLabel: t("reader.delete"),
        cancelLabel: t("reader.cancel"),
        tone: "destructive",
      }))
    )
      return;
    if (useChatStore.getState().abortControllers.has(chat.id)) {
      toast.error(t("reader.stopBeforeDelete"));
      return;
    }
    try {
      await deleteChat.mutateAsync({ id: chat.id, force: true });
      useUIStore.setState((state) => {
        const next = { ...state.readerPositions };
        delete next[chat.id];
        return { readerPositions: next };
      });
    } catch {
      /* useDeleteChat restores the cache and reports the failure. */
    }
  };
  const renameRecord = async (chat: Chat) => {
    const name = await showPromptDialog({
      title: t("reader.rename"),
      message: t("reader.renamePrompt"),
      defaultValue: chat.name,
      confirmLabel: t("reader.save"),
      cancelLabel: t("reader.cancel"),
    });
    if (!name?.trim() || name.trim() === chat.name) return;
    try {
      await updateChat.mutateAsync({ id: chat.id, name: name.trim() });
    } catch {
      toast.error(t("reader.renameError"));
    }
  };

  const filteredWorks = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language);
    if (!normalized) return works;
    return works.filter((work) =>
      `${work.title} ${work.author} ${work.chats.map((chat) => chat.name).join(" ")}`
        .toLocaleLowerCase(i18n.resolvedLanguage ?? i18n.language)
        .includes(normalized),
    );
  }, [i18n.language, i18n.resolvedLanguage, query, works]);

  const openWork = (work: VirtualWork) => {
    setSelectedWork(work);
    const lastRead = work.chats
      .filter((chat) => positions[chat.id])
      .sort((a, b) => positions[b.id].updatedAt.localeCompare(positions[a.id].updatedAt))[0];
    setActiveChatId(lastRead?.id ?? work.activeChat.id);
  };
  const createRecord = async (work: VirtualWork) => {
    const mode = await showChoiceDialog({
      title: t("libraryShell.newRecord"),
      message: work.title,
      cancelLabel: t("reader.cancel"),
      choices: [
        { key: "roleplay", label: t("libraryShell.work.body") },
        { key: "conversation", label: t("libraryShell.work.letters") },
      ],
    });
    if (mode !== "roleplay" && mode !== "conversation") return;
    const source = work.chats.find((chat) => chat.mode === mode) ?? work.activeChat;
    try {
      const chat = await createChat.mutateAsync({
        name: t("libraryShell.newRecordName", { name: work.title }),
        mode,
        characterIds: source.characterIds,
        connectionId: source.connectionId,
        personaId: source.personaId,
        promptPresetId: mode === source.mode ? source.promptPresetId : null,
      });
      setActiveChatId(chat.id);
    } catch {
      /* The existing create mutation reports failures. */
    }
  };
  const locale = i18n.resolvedLanguage ?? i18n.language;
  const loading = chats.isPending || characters.isPending;
  const failed = chats.isError || characters.isError;
  const continueWork = readWorks[0] ?? works[0] ?? null;

  useEffect(() => {
    document.documentElement.dataset.libraryShellHome = "true";
    return () => {
      delete document.documentElement.dataset.libraryShellHome;
    };
  }, []);

  if (selectedWork && section !== "settings") {
    return (
      <main
        className="flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
        data-component="LibraryWorkDetail"
      >
        <header className="shrink-0 px-5 pt-[max(1rem,env(safe-area-inset-top))] md:px-10 md:pt-7">
          <div className="mx-auto flex max-w-3xl items-center">
            <button
              type="button"
              onClick={() => setSelectedWork(null)}
              className="-ml-3 flex min-h-11 min-w-11 items-center justify-center rounded-full hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
              aria-label={t("libraryShell.work.back")}
            >
              <ArrowLeft size="1.15rem" aria-hidden="true" />
            </button>
            <span className="ml-1 text-xs font-semibold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
              {t("libraryShell.work.information")}
            </span>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-10">
          <div className="mx-auto max-w-3xl">
            <section className="grid grid-cols-[7.2rem_minmax(0,1fr)] gap-6 border-b border-[var(--border)] pb-8 pt-5 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-10 md:pb-10">
              <div className="min-w-0">
                <WorkCover work={selectedWork} className="aspect-[2/3] w-full" />
              </div>
              <div className="flex min-w-0 flex-col justify-end">
                <h1 className="text-2xl font-semibold tracking-[-0.03em] md:text-4xl">{selectedWork.title}</h1>
                <p className="mt-5 text-xs text-[var(--muted-foreground)]">
                  {formatReadTime(selectedWork.lastMessageAt, locale, t("libraryShell.ready"))}
                </p>
                <button
                  type="button"
                  onClick={() => openWork(selectedWork)}
                  className="mt-5 flex min-h-12 w-full items-center justify-center rounded-md bg-[var(--foreground)] px-4 text-sm font-semibold text-[var(--background)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)]"
                >
                  {t("libraryShell.continue")}
                </button>
              </div>
            </section>

            <section className="pt-8">
              <div className="flex items-center justify-between gap-4">
                <h2 className="text-lg font-semibold">{t("libraryShell.work.records")}</h2>
                <button
                  type="button"
                  disabled={createChat.isPending}
                  onClick={() => void createRecord(selectedWork)}
                  className="min-h-11 text-sm font-medium disabled:opacity-40"
                >
                  {t("libraryShell.newRecord")}
                </button>
              </div>
              <div className="mt-3 border-t border-[var(--border)]">
                {selectedWork.chats.map((chat) => {
                  const Icon = chat.mode === "conversation" ? MessageCircle : ScrollText;
                  const label =
                    chat.mode === "conversation" ? t("libraryShell.work.letters") : t("libraryShell.work.body");
                  const unread = unreadCounts.get(chat.id) ?? 0;
                  return (
                    <div
                      key={chat.id}
                      className="flex items-center gap-1 border-b border-[var(--border)]"
                      style={{ contentVisibility: "auto", containIntrinsicSize: "auto 72px" }}
                    >
                      <button
                        key={chat.id}
                        type="button"
                        onClick={() => setActiveChatId(chat.id)}
                        className="flex min-h-16 min-w-0 flex-1 items-center gap-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                      >
                        <Icon size="1rem" className="shrink-0 text-[var(--muted-foreground)]" aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{chat.name}</span>
                          <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                            {label} ·{" "}
                            {formatReadTime(chat.lastMessageAt ?? chat.updatedAt, locale, t("libraryShell.ready"))}
                          </span>
                        </span>
                        {unread > 0 ? (
                          <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[0.65rem] font-semibold text-[var(--primary-foreground)]">
                            {t("libraryShell.newPassages", { count: unread })}
                          </span>
                        ) : null}
                        <ChevronRight
                          size="1rem"
                          className="shrink-0 text-[var(--muted-foreground)]"
                          aria-hidden="true"
                        />
                      </button>
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded hover:bg-[var(--secondary)]"
                        disabled={updateChat.isPending || deleteChat.isPending}
                        onClick={() => void renameRecord(chat)}
                        aria-label={t("reader.renameNamed", { name: chat.name })}
                      >
                        <PencilLine size={17} />
                      </button>
                      <button
                        type="button"
                        className="flex min-h-11 min-w-11 items-center justify-center rounded text-[var(--destructive)] hover:bg-[var(--secondary)] disabled:opacity-40"
                        disabled={deleteChat.isPending || updateChat.isPending || generatingChats.has(chat.id)}
                        onClick={() => void removeRecord(chat)}
                        title={generatingChats.has(chat.id) ? t("reader.stopBeforeDelete") : undefined}
                        aria-label={t("reader.deleteNamed", { name: chat.name })}
                      >
                        <Trash2 size={17} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main
      className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[var(--background)] text-[var(--foreground)]"
      data-component="LibraryHome"
    >
      <header className="shrink-0 px-5 pb-3 pt-[max(1.15rem,env(safe-area-inset-top))] md:px-10 md:pt-8">
        <div className="mx-auto flex w-full max-w-5xl items-end justify-between gap-4">
          <div>
            <p className="text-[0.68rem] font-medium uppercase tracking-[0.2em] text-[var(--muted-foreground)]">
              {t("libraryShell.brand")}
            </p>
            <h1 className="mt-1 text-[clamp(1.65rem,4vw,2.35rem)] font-semibold tracking-[-0.035em]">
              {section === "home"
                ? t("libraryShell.home.title")
                : section === "settings"
                  ? t("settingsHub.title")
                  : section === "library"
                    ? t("libraryShell.library.title")
                    : t("libraryShell.record.title")}
            </h1>
          </div>
          <button
            type="button"
            onClick={() => useUIStore.getState().openCharacterLibrary()}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-full border border-[var(--border)] bg-transparent text-[var(--foreground)] transition-colors hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
            aria-label={t("libraryShell.newWork")}
            title={t("libraryShell.newWork")}
          >
            <Plus size="1.15rem" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-28 md:px-10 md:pb-24">
        <div className="mx-auto w-full max-w-5xl">
          {section === "settings" ? (
            <Suspense fallback={<p role="status">{t("libraryShell.loading")}</p>}>
              <LibrarySettingsHome />
            </Suspense>
          ) : loading ? (
            <div className="space-y-5 py-5" role="status" aria-label={t("libraryShell.loading")}>
              <div className="h-56 animate-pulse rounded-xl bg-[var(--secondary)]" />
              <div className="grid grid-cols-3 gap-4">
                {[0, 1, 2].map((item) => (
                  <div key={item} className="aspect-[2/3] animate-pulse rounded-md bg-[var(--secondary)]" />
                ))}
              </div>
            </div>
          ) : failed ? (
            <section className="border-t border-[var(--border)] py-10">
              <h2 className="text-xl font-semibold">{t("libraryShell.error.title")}</h2>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-[var(--muted-foreground)]">
                {t("libraryShell.error.description")}
              </p>
              <button
                type="button"
                onClick={() => {
                  void chats.refetch();
                  void characters.refetch();
                }}
                className="mt-5 min-h-11 border-b border-[var(--foreground)] text-sm font-semibold"
              >
                {t("libraryShell.retry")}
              </button>
            </section>
          ) : works.length === 0 ? (
            <section className="flex min-h-[55vh] flex-col items-start justify-center border-t border-[var(--border)]">
              <BookOpen size="1.5rem" className="text-[var(--muted-foreground)]" aria-hidden="true" />
              <h2 className="mt-5 text-2xl font-semibold">{t("libraryShell.empty.title")}</h2>
              <p className="mt-2 max-w-sm text-sm leading-relaxed text-[var(--muted-foreground)]">
                {t("libraryShell.empty.description")}
              </p>
              <button
                type="button"
                onClick={() => useUIStore.getState().openCharacterLibrary()}
                className="mt-6 min-h-11 border-b border-[var(--foreground)] text-sm font-semibold"
              >
                {t("libraryShell.empty.action")}
              </button>
            </section>
          ) : section === "home" && continueWork ? (
            <>
              <button
                type="button"
                onClick={() => openWork(continueWork)}
                className="group grid w-full grid-cols-[6.6rem_minmax(0,1fr)] gap-5 border-y border-[var(--border)] py-5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)] md:grid-cols-[8rem_minmax(0,1fr)] md:gap-8 md:py-7"
              >
                <WorkCover work={continueWork} className="aspect-[2/3] w-full" />
                <span className="flex min-w-0 flex-col justify-center">
                  <span className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-[var(--primary)]">
                    {t("libraryShell.continue")}
                  </span>
                  <span className="mt-2 line-clamp-2 text-xl font-semibold tracking-[-0.02em] md:text-3xl">
                    {continueWork.title}
                  </span>
                  <span className="mt-1 truncate text-sm text-[var(--muted-foreground)]">{continueWork.author}</span>
                  {continueWork.preview ? (
                    <span className="mt-4 line-clamp-2 max-w-xl text-sm leading-relaxed text-[var(--muted-foreground)]">
                      {continueWork.preview}
                    </span>
                  ) : null}
                  <span className="mt-5 flex items-center gap-2 text-xs font-medium text-[var(--foreground)]">
                    {formatReadTime(continueWork.lastMessageAt, locale, t("libraryShell.ready"))}
                    {continueWork.unreadCount > 0 ? (
                      <span className="rounded-full bg-[var(--primary)] px-2 py-0.5 text-[var(--primary-foreground)]">
                        {t("libraryShell.newPassages", { count: continueWork.unreadCount })}
                      </span>
                    ) : null}
                    <ChevronRight
                      size="0.95rem"
                      className="ml-auto transition-transform group-hover:translate-x-0.5"
                      aria-hidden="true"
                    />
                  </span>
                </span>
              </button>

              <section className="pt-8">
                <div className="mb-4 flex items-center justify-between gap-4">
                  <h2 className="text-lg font-semibold">{t("libraryShell.recent")}</h2>
                  <button
                    type="button"
                    onClick={() => setSection("library")}
                    className="min-h-11 text-xs font-semibold text-[var(--muted-foreground)] hover:text-[var(--foreground)]"
                  >
                    {t("libraryShell.viewAll")}
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-x-4 gap-y-7 md:grid-cols-5 md:gap-x-6">
                  {works.slice(0, 3).map((work) => (
                    <button
                      key={work.id}
                      type="button"
                      onClick={() => setSelectedWork(work)}
                      className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                    >
                      <WorkCover work={work} className="aspect-[2/3] w-full" />
                      <span className="mt-3 block truncate text-sm font-semibold">{work.title}</span>
                      <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">
                        {work.author}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            </>
          ) : section === "library" ? (
            <section>
              <label className="flex min-h-12 items-center gap-3 border-y border-[var(--border)] text-[var(--muted-foreground)] focus-within:text-[var(--foreground)]">
                <Search size="1rem" aria-hidden="true" />
                <span className="sr-only">{t("libraryShell.search.label")}</span>
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t("libraryShell.search.placeholder")}
                  className="h-12 min-w-0 flex-1 bg-transparent text-sm text-[var(--foreground)] outline-none placeholder:text-[var(--muted-foreground)]"
                />
              </label>
              <p className="py-5 text-xs text-[var(--muted-foreground)]">
                {t("libraryShell.workCount", { count: filteredWorks.length })}
              </p>
              <div className="grid grid-cols-3 gap-x-4 gap-y-8 sm:grid-cols-4 md:grid-cols-5 md:gap-x-7">
                {filteredWorks.map((work) => (
                  <button
                    key={work.id}
                    style={{ contentVisibility: "auto", containIntrinsicSize: "auto 280px" }}
                    type="button"
                    onClick={() => setSelectedWork(work)}
                    className="min-w-0 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                  >
                    <WorkCover work={work} className="aspect-[2/3] w-full" />
                    <span className="mt-3 block truncate text-sm font-semibold">{work.title}</span>
                    <span className="mt-0.5 block truncate text-xs text-[var(--muted-foreground)]">{work.author}</span>
                    {work.unreadCount > 0 ? (
                      <span className="mt-1 block text-[0.68rem] font-semibold text-[var(--primary)]">
                        {t("libraryShell.newPassages", { count: work.unreadCount })}
                      </span>
                    ) : null}
                  </button>
                ))}
              </div>
            </section>
          ) : (
            <section className="border-t border-[var(--border)]">
              {readWorks.length === 0 && (
                <p className="py-10 text-sm text-[var(--muted-foreground)]">{t("reader.noHistory")}</p>
              )}
              {readWorks.map((work) => (
                <button
                  key={work.id}
                  type="button"
                  onClick={() => setSelectedWork(work)}
                  className="flex min-h-20 w-full items-center gap-4 border-b border-[var(--border)] py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]"
                >
                  <WorkCover work={work} className="h-14 w-10 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{work.title}</span>
                    <span className="mt-1 block text-xs text-[var(--muted-foreground)]">
                      {formatReadTime(work.lastMessageAt, locale, t("libraryShell.ready"))}
                    </span>
                  </span>
                  <ChevronRight size="1rem" className="text-[var(--muted-foreground)]" aria-hidden="true" />
                </button>
              ))}
            </section>
          )}
        </div>
      </div>

      <nav
        className="absolute inset-x-0 bottom-0 z-10 border-t border-[var(--border)] bg-[var(--background)]/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-sm"
        aria-label={t("libraryShell.navigation")}
      >
        <div className="mx-auto grid min-h-16 max-w-lg grid-cols-4">
          {[
            { id: "home" as const, icon: Home, label: t("libraryShell.nav.home") },
            { id: "library" as const, icon: LibraryBig, label: t("libraryShell.nav.library") },
            { id: "record" as const, icon: Clock3, label: t("libraryShell.nav.record") },
          ].map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              aria-current={section === id ? "page" : undefined}
              className={cn(
                "flex min-h-16 flex-col items-center justify-center gap-1 text-[0.66rem] font-medium text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]",
                section === id && "text-[var(--foreground)]",
              )}
            >
              <Icon size="1.1rem" strokeWidth={section === id ? 2.2 : 1.6} aria-hidden="true" />
              {label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSection("settings")}
            aria-current={section === "settings" ? "page" : undefined}
            className="flex min-h-16 flex-col items-center justify-center gap-1 text-[0.66rem] font-medium text-[var(--muted-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--primary)]"
          >
            <Settings size="1.1rem" strokeWidth={1.6} aria-hidden="true" />
            {t("libraryShell.nav.settings")}
          </button>
        </div>
      </nav>
    </main>
  );
}
