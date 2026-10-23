import { useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  BUILTIN_TRANSLATION_PRESETS,
  DEFAULT_TRANSLATION_SYSTEM_PROMPT,
  INHERIT_TRANSLATION_PRESET_ID,
  type NativeIntegrations,
} from "@marinara-engine/shared";
import { SettingsSwitch } from "../../../components/panels/settings/SettingControls";
import { Modal } from "../../../components/ui/Modal";
import {
  useNativeIntegrations,
  useSaveNativeIntegrations,
  useTranslationScan,
} from "../../../hooks/use-native-integrations";
import { useLorebookEntries, useLorebooks } from "../../../hooks/use-lorebooks";
import { showConfirmDialog } from "../../../lib/app-dialogs";
import { downloadJsonFile } from "../../../lib/download-json";
import { importNativeIntegrationBackup } from "../../../lib/native-integration-import";
import {
  TRANSLATION_BACKUP_KIND,
  mergeGlossary,
  mergeVoice,
  parseVoice,
  voiceRows as readVoiceRows,
  writeVoice,
  type VoiceRow,
} from "../../../lib/translation-panel";

type Room = NativeIntegrations["translation"]["defaults"];
type Preset = { id: string; name: string; prompt: string; replace: boolean; builtin: boolean };
type Direction = "outgoing" | "incoming";
type Status = { text: string; kind: "info" | "error" | "success" };

/** Same classes as the translation extension (v1.6.4), which copied the native translation section. */
const UI = {
  label: "text-[0.6875rem] font-medium text-[var(--muted-foreground)]",
  select:
    "mt-0.5 w-full rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40",
  input: "mari-chrome-field mt-0.5 w-full !rounded-md px-3 py-2 text-xs",
  textarea:
    "mt-0.5 w-full resize-y rounded-lg bg-[var(--secondary)] px-3 py-2 text-xs leading-relaxed outline-none ring-1 ring-transparent transition-shadow focus:ring-[var(--primary)]/40",
  help: "text-[0.625rem] leading-relaxed text-[var(--marinara-chat-chrome-panel-muted)]",
  title: "text-xs font-semibold text-[var(--foreground)]",
  button:
    "flex shrink-0 items-center gap-1 rounded-md bg-[var(--secondary)] px-2 py-0.5 text-[0.625rem] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]",
  save: "rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90",
  remove:
    "flex shrink-0 items-center justify-center rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--destructive)]/10 hover:text-[var(--destructive)]",
};
const FREE_CONTEXT_MAX = 4000;
const PROMPT_MAX = 5000;

function Switch({
  checked,
  onChange,
  title,
  description,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  description?: string;
}) {
  return (
    <SettingsSwitch
      label={title}
      description={description}
      checked={checked}
      onChange={onChange}
      labelPosition="start"
      className={[
        "justify-between rounded-lg px-3 py-2.5 text-left",
        checked
          ? "bg-[var(--primary)]/10 ring-1 ring-[var(--primary)]/30"
          : "bg-[var(--secondary)] hover:bg-[var(--accent)]",
      ].join(" ")}
      labelClassName="text-[0.6875rem] font-medium"
    />
  );
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="tpg-group">
      <h5 className={UI.title}>{title}</h5>
      {children}
    </section>
  );
}

/** Review list of scan results, like the extension's pickRows: new rows are checked, unchanged rows locked. */
function ReviewRows({
  rows,
  onConfirm,
}: {
  rows: Array<{ title: string; body?: string; status: "new" | "changed" | "same"; old?: string }>;
  onConfirm: (picked: number[]) => void;
}) {
  const { t } = useTranslation();
  const [checked, setChecked] = useState(() => rows.map((row) => row.status === "new"));
  if (!rows.length) return <p className="py-6 text-center text-xs">{t("translationPanel.scanEmpty")}</p>;
  return (
    <div className="space-y-2 text-xs">
      {rows.map((row, index) => (
        <label
          key={index}
          className="flex min-h-11 items-start gap-2 rounded-lg border border-[var(--border)] p-2"
          data-status={row.status}
        >
          <input
            type="checkbox"
            className="mt-0.5"
            checked={checked[index]}
            disabled={row.status === "same"}
            onChange={(event) => setChecked(checked.map((value, i) => (i === index ? event.target.checked : value)))}
          />
          <span className="rounded bg-[var(--secondary)] px-1.5 py-0.5 text-[0.625rem]">
            {t(`translationPanel.status.${row.status}`)}
          </span>
          <span className="min-w-0 flex-1 space-y-1">
            <b className="block break-words">{row.title}</b>
            {row.body && <span className="block whitespace-pre-wrap break-words">{row.body}</span>}
            {row.status === "changed" && row.old && (
              <span className={`block whitespace-pre-wrap break-words ${UI.help}`}>
                {t("translationPanel.current", { value: row.old })}
              </span>
            )}
          </span>
        </label>
      ))}
      <div className="flex justify-end">
        <button
          type="button"
          className={UI.save}
          onClick={() => onConfirm(checked.flatMap((value, index) => (value ? [index] : [])))}
        >
          {t("translationPanel.addSelected")}
        </button>
      </div>
    </div>
  );
}

type LoreRef = Room["loreEntries"][number];

function LoreBook({
  book,
  picked,
  onToggle,
}: {
  book: { id: string; name: string };
  picked: LoreRef[];
  onToggle: (ref: LoreRef, chars: number) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(picked.some((ref) => ref.book === book.id));
  const entries = useLorebookEntries(open ? book.id : null);
  const rows = (entries.data ?? []).filter((entry) => entry.content.trim());
  return (
    <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="min-h-11 cursor-pointer py-3 font-semibold">
        {book.name || t("integrations.unnamedEntry")}
        {picked.some((ref) => ref.book === book.id) && (
          <small className="ml-2 font-normal">
            {t("translationPanel.loreCount", { count: picked.filter((ref) => ref.book === book.id).length })}
          </small>
        )}
      </summary>
      {entries.isLoading && <p role="status">{t("integrations.loading")}</p>}
      {entries.isError && <p role="alert">{t("integrations.loadError")}</p>}
      <div className="space-y-1">
        {rows.map((entry) => {
          const on = picked.some((ref) => ref.book === book.id && ref.id === entry.id);
          const content = entry.content.trim();
          return (
            <label
              key={entry.id}
              className="flex min-h-11 items-start gap-2 rounded-lg border border-[var(--border)] p-2"
            >
              <input
                type="checkbox"
                className="mt-0.5"
                checked={on}
                onChange={() => onToggle({ book: book.id, id: entry.id }, content.length)}
              />
              <span className="min-w-0 flex-1">
                <b>
                  {entry.name || entry.keys[0] || t("integrations.unnamedEntry")}{" "}
                  <small>{t("translationPanel.chars", { count: content.length })}</small>
                </b>
                <span className="line-clamp-2 block break-words opacity-80">{content}</span>
              </span>
            </label>
          );
        })}
      </div>
    </details>
  );
}

/** Lorebook entries read with the 기타 지침 on every translation (the extension's 로어북 항목 선택). */
function LorePicker({ value, onSave }: { value: LoreRef[]; onSave: (value: LoreRef[]) => void }) {
  const { t } = useTranslation();
  const books = useLorebooks();
  const [picked, setPicked] = useState(value);
  const list = (books.data ?? []) as Array<{ id: string; name: string }>;
  return (
    <div className="space-y-2 text-xs">
      <p className={UI.help}>{t("translationPanel.loreHelp")}</p>
      {books.isLoading && <p role="status">{t("integrations.loading")}</p>}
      {!books.isLoading && !list.length && <p className="py-6 text-center">{t("translationPanel.noLore")}</p>}
      {list.map((book) => (
        <LoreBook
          key={book.id}
          book={book}
          picked={picked}
          onToggle={(ref) =>
            setPicked(
              picked.some((row) => row.book === ref.book && row.id === ref.id)
                ? picked.filter((row) => row.book !== ref.book || row.id !== ref.id)
                : [...picked, ref],
            )
          }
        />
      ))}
      <div className="flex items-center justify-between gap-2 pt-2">
        <span>{picked.length ? t("translationPanel.loreCount", { count: picked.length }) : ""}</span>
        <button type="button" className={UI.save} onClick={() => onSave(picked)}>
          {t("reader.save")}
        </button>
      </div>
    </div>
  );
}

/**
 * The translation extension's panel, placed inside the chat's native translation section.
 * Choosing a preset writes its prompt into the native outgoing/incoming prompt fields (the only prompt source);
 * glossary, voice notes, setting notes and conversation context are per-chat references added to each request.
 */
export function TranslationPresetPanel({
  chatId,
  chatName,
  provider,
  prompts,
  onPromptChange,
}: {
  chatId: string;
  chatName: string;
  provider: string;
  /** The chat's stored prompts; "" means the default prompt. */
  prompts: Record<Direction, string>;
  onPromptChange: (direction: Direction, value: string | null) => void;
}) {
  const { t } = useTranslation();
  const query = useNativeIntegrations();
  const save = useSaveNativeIntegrations();
  const scan = useTranslationScan();
  const [draft, setDraft] = useState<NativeIntegrations | null>(null);
  const [status, setStatus] = useState<Status>({ text: "", kind: "info" });
  const [managed, setManaged] = useState(INHERIT_TRANSLATION_PRESET_ID);
  const [editing, setEditing] = useState<{ id: string; creating: boolean; snapshot: Preset | null } | null>(null);
  const [review, setReview] = useState<null | {
    title: string;
    rows: Array<{ title: string; body?: string; status: "new" | "changed" | "same"; old?: string }>;
    apply: (picked: number[]) => void;
  }>(null);
  const [world, setWorld] = useState<string | null>(null);
  const [lore, setLore] = useState(false);
  const [scanning, setScanning] = useState<null | "glossary" | "speech" | "world">(null);
  // Rows being typed keep their place in the editor even before they hold text (the stored form drops them).
  const [voiceDraft, setVoiceDraft] = useState<VoiceRow[] | null>(null);
  const scanRun = useRef(0);
  const migrated = useRef(false);
  useEffect(() => {
    if (query.data && !draft) setDraft(query.data);
  }, [query.data, draft]);

  const presets: Preset[] = [
    ...BUILTIN_TRANSLATION_PRESETS.map((preset) => ({ ...preset, builtin: true })),
    ...(draft?.translation.presets ?? []).map((preset) => ({
      id: preset.id,
      name: preset.name,
      prompt: preset.prompt,
      replace: preset.replace,
      builtin: false,
    })),
  ];
  const room: Room | null = draft ? (draft.translation.rooms[chatId] ?? draft.translation.defaults) : null;
  const ai = provider === "ai";
  const promptLabel = (direction: Direction) =>
    t(direction === "outgoing" ? "translationPanel.outgoingPrompt" : "translationPanel.incomingPrompt");
  const selectedId = (direction: Direction) =>
    (direction === "outgoing" ? room?.outgoingPresetId : room?.presetId) ?? INHERIT_TRANSLATION_PRESET_ID;
  const nativeValue = (value: string) =>
    !value.trim() || value.trim() === DEFAULT_TRANSLATION_SYSTEM_PROMPT.trim() ? null : value;

  const withRoom = (base: NativeIntegrations, next: Room): NativeIntegrations => ({
    ...base,
    translation: { ...base.translation, rooms: { ...base.translation.rooms, [chatId]: next } },
  });
  const patchRoom = (patch: Partial<Room>) => {
    if (!draft || !room) return;
    setDraft(withRoom(draft, { ...room, ...patch }));
  };
  const persist = (next: NativeIntegrations, success?: string) =>
    save.mutateAsync(next).then(
      (saved) => {
        setDraft(saved);
        if (success) setStatus({ text: success, kind: "success" });
        return true;
      },
      () => {
        setStatus({ text: t("integrations.saveConflict"), kind: "error" });
        return false;
      },
    );

  /** Writes the preset into the chat's own prompt field and remembers the choice right away, like the extension. */
  const applyPreset = (direction: Direction, id: string) => {
    if (!draft || !room || !query.data) return;
    if (!ai) {
      setStatus({ text: t("translationPanel.needAi"), kind: "error" });
      return;
    }
    const preset = presets.find((row) => row.id === id);
    if (!preset) {
      setStatus({ text: t("translationPanel.presetMissing"), kind: "error" });
      return;
    }
    const originalKey = direction === "outgoing" ? "outgoingOriginalPrompt" : "incomingOriginalPrompt";
    const original = room[originalKey] ?? prompts[direction];
    const value = preset.replace ? preset.prompt : original;
    if (value.length > PROMPT_MAX) {
      setStatus({ text: t("translationPanel.promptTooLong", { max: PROMPT_MAX }), kind: "error" });
      return;
    }
    onPromptChange(direction, nativeValue(value));
    const choice: Partial<Room> = {
      [direction === "outgoing" ? "outgoingPresetId" : "presetId"]: id === INHERIT_TRANSLATION_PRESET_ID ? null : id,
      [originalKey]: original,
      presetsInNative: true,
    };
    patchRoom(choice);
    // Only the choice is saved now; other unsaved edits in this panel wait for 저장.
    const serverRoom = query.data.translation.rooms[chatId] ?? query.data.translation.defaults;
    void persist(
      withRoom(query.data, { ...serverRoom, ...choice }),
      t("translationPanel.applied", { label: promptLabel(direction) }),
    );
  };

  // Rooms from before this panel used a server-side preset; show it in the chat's prompt field once.
  useEffect(() => {
    if (!draft || !room || migrated.current || room.presetsInNative || !ai) return;
    migrated.current = true;
    for (const direction of ["outgoing", "incoming"] as const) {
      const id = selectedId(direction);
      const preset = presets.find((row) => row.id === id);
      if (!preset?.replace || id === INHERIT_TRANSLATION_PRESET_ID) continue;
      if (prompts[direction].trim()) {
        setStatus({ text: t("translationPanel.legacyKept", { name: preset.name }), kind: "info" });
        return;
      }
    }
    for (const direction of ["outgoing", "incoming"] as const) {
      const id = selectedId(direction);
      if (id !== INHERIT_TRANSLATION_PRESET_ID) applyPreset(direction, id);
    }
    // Runs once per open room when its stored data first arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft, ai]);

  if (!draft || !room)
    return (
      <p role="status" className={UI.help}>
        {t(query.isError ? "integrations.loadError" : "integrations.loading")}
      </p>
    );

  const custom = draft.translation.presets;
  const managedPreset = presets.find((row) => row.id === managed) ?? presets[0]!;
  const editorOpen = editing?.id === managedPreset.id;
  const setCustom = (next: NativeIntegrations["translation"]["presets"]) =>
    setDraft({ ...draft, translation: { ...draft.translation, presets: next } });
  const voiceOn = room.voiceEnabled ?? !!room.style.trim();
  const worldOn = room.freeContextEnabled ?? !!(room.freeContext.trim() || room.loreEntries.length);
  const contextOn = room.contextEnabled ?? room.contextMessages > 0;
  const voiceRows = voiceDraft ?? readVoiceRows(room.style);
  const setVoiceRows = (rows: VoiceRow[]) => {
    setVoiceDraft(rows);
    patchRoom({ style: writeVoice(rows) });
  };

  const runScan = async (kind: "glossary" | "speech" | "world") => {
    if (!ai) {
      setStatus({ text: t("translationPanel.needAi"), kind: "error" });
      return;
    }
    const run = ++scanRun.current;
    setScanning(kind);
    try {
      const result = await scan.mutateAsync({ chatId, kind });
      // Closing the progress window cancels the review, like the extension's 중지.
      if (run !== scanRun.current) return;
      if ("text" in result) {
        if (!result.text) setStatus({ text: t("translationPanel.noWorld"), kind: "info" });
        else setWorld(result.text);
        return;
      }
      if (kind === "glossary") {
        const found = result.entries as Array<{ source: string; target: string }>;
        const rows = found.map((entry) => {
          const old = room.glossary.find((row) => row.source === entry.source || row.target === entry.source);
          const other = old ? (old.source === entry.source ? old.target : old.source) : "";
          return {
            title: `${entry.source} = ${entry.target}`,
            status: (!old ? "new" : other === entry.target ? "same" : "changed") as "new" | "changed" | "same",
            old: old ? `${entry.source} = ${other}` : "",
          };
        });
        setReview({
          title: t("translationPanel.glossaryResult"),
          rows,
          apply: (picked) =>
            patchRoom({
              glossary: mergeGlossary(
                room.glossary,
                picked.map((i) => found[i]!),
              ),
            }),
        });
      } else {
        const found = result.entries as Array<{ name: string; style: string }>;
        const blocks = parseVoice(room.style).blocks;
        const rows = found.map((entry) => {
          const old = blocks.find((block) => block.name === entry.name);
          return {
            title: entry.name,
            body: entry.style,
            status: (!old ? "new" : old.style === entry.style ? "same" : "changed") as "new" | "changed" | "same",
            old: old?.style ?? "",
          };
        });
        setReview({
          title: t("translationPanel.speechResult"),
          rows,
          apply: (picked) => {
            setVoiceDraft(null);
            patchRoom({
              style: mergeVoice(
                room.style,
                picked.map((i) => found[i]!),
              ),
              voiceEnabled: true,
            });
          },
        });
      }
    } catch (error) {
      if (run !== scanRun.current) return;
      setStatus({
        text: t("translationPanel.scanFailed", { message: error instanceof Error ? error.message : "" }),
        kind: "error",
      });
    } finally {
      if (run === scanRun.current) setScanning(null);
    }
  };

  const submit = async () => {
    const invalid = custom.find((preset) => !preset.name.trim() || !preset.prompt.trim());
    if (invalid) {
      setStatus({ text: t("translationPanel.presetIncomplete"), kind: "error" });
      return;
    }
    if (voiceOn && !room.style.trim()) {
      setStatus({ text: t("translationPanel.voiceEmpty"), kind: "error" });
      return;
    }
    setStatus({ text: t("translationPanel.saving"), kind: "info" });
    const next = withRoom(draft, {
      ...room,
      // Half-typed pairs are not saved, as the extension's editor dropped them.
      glossary: room.glossary
        .map((row) => ({ ...row, source: row.source.trim(), target: row.target.trim() }))
        .filter((row) => row.source && row.target),
      voiceEnabled: voiceOn,
      freeContextEnabled: worldOn,
      contextEnabled: contextOn,
    });
    if (await persist(next, t("integrations.saved"))) setEditing(null);
  };

  const exportBackup = (type: "chat" | "all") => {
    const exportedAt = new Date().toISOString();
    const stamp = exportedAt.slice(0, 10);
    const presetsOf = (ids: Array<string | null>) =>
      custom
        .filter((preset) => !ids.length || ids.includes(preset.id))
        .map(({ id, name, prompt }) => ({ id, name, prompt }));
    if (type === "all") {
      void downloadJsonFile(
        {
          kind: TRANSLATION_BACKUP_KIND,
          v: 1,
          type: "all",
          exportedAt,
          presets: presetsOf([]),
          defaults: toExtensionScope(draft.translation.defaults),
          chats: Object.fromEntries(
            Object.entries(draft.translation.rooms).map(([id, value]) => [id, toExtensionScope(value)]),
          ),
        },
        t("translationPanel.fileAll", { stamp }),
      );
      setStatus({ text: t("translationPanel.exportedAll"), kind: "success" });
      return;
    }
    const name =
      chatName
        .replace(/[\\/:*?"<>|]+/gu, "_")
        .trim()
        .slice(0, 40) || t("translationPanel.chat");
    void downloadJsonFile(
      {
        kind: TRANSLATION_BACKUP_KIND,
        v: 1,
        type: "chat",
        exportedAt,
        chat: chatName,
        scope: toExtensionScope(room),
        presets: presetsOf([room.outgoingPresetId, room.presetId].filter(Boolean)),
      },
      t("translationPanel.fileChat", { name, stamp }),
    );
    setStatus({ text: t("translationPanel.exportedChat", { name: chatName }), kind: "success" });
  };

  const importBackup = (file: File) => {
    void (async () => {
      try {
        if (file.size > 5_000_000) throw new Error(t("translationPanel.notBackup"));
        const data = JSON.parse(await file.text()) as { kind?: unknown };
        if (data?.kind !== TRANSLATION_BACKUP_KIND) throw new Error(t("translationPanel.notBackup"));
        const next = importNativeIntegrationBackup(data, draft, chatId);
        if (
          !(await showConfirmDialog({
            title: t("translationPanel.import"),
            message: t("translationPanel.importConfirm"),
          }))
        )
          return;
        setDraft({ ...next, revision: draft.revision });
        setVoiceDraft(null);
        setStatus({ text: t("translationPanel.imported"), kind: "success" });
      } catch (error) {
        setStatus({ text: error instanceof Error ? error.message : t("integrations.importError"), kind: "error" });
      }
    })();
  };

  const presetOptions = presets.map((preset) => (
    <option key={preset.id} value={preset.id}>
      {preset.builtin ? preset.name : t("translationPanel.customPreset", { name: preset.name })}
    </option>
  ));

  return (
    <form
      className="tpg-form"
      data-component="TranslationPresetPanel"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <Group title={t("translationPanel.prompts")}>
        {(["outgoing", "incoming"] as const).map((direction) => (
          <div key={direction}>
            <label className={UI.label} htmlFor={`tpg-${direction}-${chatId}`}>
              {promptLabel(direction)}
            </label>
            <select
              id={`tpg-${direction}-${chatId}`}
              className={UI.select}
              aria-label={t("translationPanel.presetFor", { label: promptLabel(direction) })}
              value={selectedId(direction)}
              disabled={save.isPending}
              onChange={(event) => applyPreset(direction, event.target.value)}
            >
              {presetOptions}
            </select>
          </div>
        ))}
        {!ai && <p className={UI.help}>{t("translationPanel.needAi")}</p>}
      </Group>
      <Group title={t("translationPanel.instructions")}>
        <Switch
          checked={voiceOn}
          onChange={(value) => {
            patchRoom({ voiceEnabled: value });
            if (value && !voiceRows.length) setVoiceRows([{ name: "", style: "" }]);
          }}
          title={t("translationPanel.voice")}
          description={t("translationPanel.voiceHelp")}
        />
        {voiceOn && (
          <div className="tpg-group-body">
            <div className="tpg-pairs">
              {voiceRows.map((row, index) => (
                <div key={index} className="tpg-pair is-voice">
                  <input
                    className={UI.input}
                    autoComplete="off"
                    spellCheck={false}
                    placeholder={t("translationPanel.voiceNamePlaceholder")}
                    aria-label={t("translationPanel.voiceName")}
                    value={row.name}
                    onChange={(event) =>
                      setVoiceRows(
                        voiceRows.map((item, i) => (i === index ? { ...item, name: event.target.value } : item)),
                      )
                    }
                  />
                  <textarea
                    className={UI.textarea}
                    rows={2}
                    spellCheck={false}
                    placeholder={t("translationPanel.voiceStylePlaceholder")}
                    aria-label={t("translationPanel.voiceStyle")}
                    value={row.style}
                    onChange={(event) =>
                      setVoiceRows(
                        voiceRows.map((item, i) => (i === index ? { ...item, style: event.target.value } : item)),
                      )
                    }
                  />
                  <button
                    type="button"
                    className={UI.remove}
                    title={t("translationPanel.remove")}
                    aria-label={t("translationPanel.remove")}
                    onClick={() => setVoiceRows(voiceRows.filter((_, i) => i !== index))}
                  >
                    <X size="0.875rem" aria-hidden="true" />
                  </button>
                </div>
              ))}
              {!voiceRows.length && <p className={UI.help}>{t("translationPanel.voiceEmptyList")}</p>}
            </div>
            <div className="tpg-inline-actions">
              <button
                type="button"
                className={UI.button}
                onClick={() => setVoiceRows([...voiceRows, { name: "", style: "" }])}
              >
                {t("translationPanel.addPerson")}
              </button>
              <button
                type="button"
                className={UI.button}
                disabled={scanning !== null}
                onClick={() => void runScan("speech")}
              >
                {t("translationPanel.scanSpeech")}
              </button>
            </div>
            <p className={UI.help}>{t("translationPanel.voiceMacroHelp")}</p>
          </div>
        )}
        <Switch
          checked={worldOn}
          onChange={(value) => patchRoom({ freeContextEnabled: value })}
          title={t("translationPanel.freeContext")}
          description={t("translationPanel.freeContextHelp")}
        />
        {worldOn && (
          <div className="tpg-group-body">
            <textarea
              className={UI.textarea}
              rows={2}
              maxLength={FREE_CONTEXT_MAX}
              spellCheck={false}
              aria-label={t("translationPanel.freeContextLabel")}
              placeholder={t("translationPanel.freeContextPlaceholder")}
              value={room.freeContext}
              onChange={(event) => patchRoom({ freeContext: event.target.value })}
            />
            <div className="tpg-inline-actions">
              <button type="button" className={UI.button} onClick={() => setLore(true)}>
                {t("translationPanel.pickLore")}
              </button>
              <button
                type="button"
                className={UI.button}
                disabled={scanning !== null}
                onClick={() => void runScan("world")}
              >
                {t("translationPanel.scanWorld")}
              </button>
            </div>
            {room.loreEntries.length > 0 && (
              <p className={UI.help}>{t("translationPanel.loreCount", { count: room.loreEntries.length })}</p>
            )}
          </div>
        )}
      </Group>
      <Group title={t("translationPanel.glossary")}>
        <div className="tpg-pairs">
          {room.glossary.map((entry, index) => (
            <div key={index} className="tpg-pair">
              <input
                className={UI.input}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("translationPanel.sourcePlaceholder")}
                aria-label={t("translationPanel.source")}
                value={entry.source}
                onChange={(event) =>
                  patchRoom({
                    glossary: room.glossary.map((row, i) =>
                      i === index ? { ...row, source: event.target.value } : row,
                    ),
                  })
                }
              />
              <span className={`tpg-pair-sep ${UI.label}`} aria-hidden="true">
                =
              </span>
              <input
                className={UI.input}
                autoComplete="off"
                spellCheck={false}
                placeholder={t("translationPanel.targetPlaceholder")}
                aria-label={t("translationPanel.target")}
                value={entry.target}
                onChange={(event) =>
                  patchRoom({
                    glossary: room.glossary.map((row, i) =>
                      i === index ? { ...row, target: event.target.value } : row,
                    ),
                  })
                }
              />
              <button
                type="button"
                className={UI.remove}
                title={t("translationPanel.remove")}
                aria-label={t("translationPanel.remove")}
                onClick={() => patchRoom({ glossary: room.glossary.filter((_, i) => i !== index) })}
              >
                <X size="0.875rem" aria-hidden="true" />
              </button>
            </div>
          ))}
          {!room.glossary.length && <p className={UI.help}>{t("translationPanel.glossaryEmpty")}</p>}
        </div>
        <div className="tpg-inline-actions">
          <button
            type="button"
            className={UI.button}
            onClick={() => patchRoom({ glossary: [...room.glossary, { source: "", target: "", notes: "" }] })}
          >
            {t("translationPanel.addTerm")}
          </button>
          <button
            type="button"
            className={UI.button}
            disabled={scanning !== null}
            onClick={() => void runScan("glossary")}
          >
            {t("translationPanel.scanGlossary")}
          </button>
        </div>
        <p className={UI.help}>{t("translationPanel.glossaryHelp")}</p>
      </Group>
      <Group title={t("translationPanel.context")}>
        <Switch
          checked={contextOn}
          onChange={(value) =>
            patchRoom({
              contextEnabled: value,
              contextMessages: value ? Math.min(10, Math.max(1, room.contextMessages || 3)) : room.contextMessages,
            })
          }
          title={t("translationPanel.contextOn")}
          description={t("translationPanel.contextHelp")}
        />
        {contextOn && (
          <div className="tpg-group-body">
            <Switch
              checked={room.contextIncludeOriginal}
              onChange={(value) => patchRoom({ contextIncludeOriginal: value })}
              title={t("translationPanel.contextOriginal")}
            />
            <Switch
              checked={room.contextIncludeTranslation}
              onChange={(value) => patchRoom({ contextIncludeTranslation: value })}
              title={t("translationPanel.contextTranslation")}
            />
            <Switch
              checked={room.contextIncludeUserInput}
              onChange={(value) => patchRoom({ contextIncludeUserInput: value })}
              title={t("translationPanel.contextUserInput")}
            />
            <div className="tpg-context-count">
              <label className={UI.label} htmlFor={`tpg-count-${chatId}`}>
                {t("translationPanel.contextCount")}
              </label>
              <input
                id={`tpg-count-${chatId}`}
                type="number"
                className={UI.input}
                min={1}
                max={10}
                step={1}
                inputMode="numeric"
                value={room.contextMessages || 3}
                onChange={(event) =>
                  patchRoom({ contextMessages: Math.min(10, Math.max(1, Number(event.target.value) || 1)) })
                }
              />
            </div>
          </div>
        )}
      </Group>
      <Group title={t("translationPanel.backup")}>
        <div className="tpg-inline-actions">
          <button type="button" className={UI.button} onClick={() => exportBackup("chat")}>
            {t("translationPanel.exportChat")}
          </button>
          <button type="button" className={UI.button} onClick={() => exportBackup("all")}>
            {t("translationPanel.exportAll")}
          </button>
          <label className={`${UI.button} cursor-pointer`}>
            {t("translationPanel.import")}
            <input
              className="hidden"
              type="file"
              accept="application/json,.json"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (file) importBackup(file);
              }}
            />
          </label>
        </div>
        <p className={UI.help}>{t("translationPanel.backupHelp")}</p>
      </Group>
      <Group title={t("translationPanel.manage")}>
        <select
          className={UI.select}
          aria-label={t("translationPanel.managePreset")}
          value={managedPreset.id}
          disabled={!!editing}
          onChange={(event) => {
            const preset = presets.find((row) => row.id === event.target.value);
            setManaged(event.target.value);
            setEditing(preset && !preset.builtin ? { id: preset.id, creating: false, snapshot: { ...preset } } : null);
          }}
        >
          {presetOptions}
        </select>
        {editorOpen && !managedPreset.builtin && (
          <div className="tpg-preset-editor">
            <div>
              <label className={UI.label} htmlFor={`tpg-name-${chatId}`}>
                {t("translationPanel.presetName")}
              </label>
              <input
                id={`tpg-name-${chatId}`}
                className={UI.input}
                maxLength={80}
                autoComplete="off"
                value={managedPreset.name}
                onChange={(event) =>
                  setCustom(
                    custom.map((row) => (row.id === managedPreset.id ? { ...row, name: event.target.value } : row)),
                  )
                }
              />
            </div>
            <div>
              <label className={UI.label} htmlFor={`tpg-prompt-${chatId}`}>
                {t("translationPanel.presetPrompt")}
              </label>
              <textarea
                id={`tpg-prompt-${chatId}`}
                className={`${UI.textarea} min-h-28 font-mono`}
                rows={7}
                spellCheck={false}
                placeholder={t("translationPanel.presetPromptPlaceholder")}
                value={managedPreset.prompt}
                onChange={(event) =>
                  setCustom(
                    custom.map((row) => (row.id === managedPreset.id ? { ...row, prompt: event.target.value } : row)),
                  )
                }
              />
            </div>
          </div>
        )}
        <div className="tpg-inline-actions">
          <button
            type="button"
            className={UI.button}
            disabled={!!editing}
            onClick={() => {
              const id = `custom-${crypto.randomUUID()}`;
              const literary = BUILTIN_TRANSLATION_PRESETS.find((row) => row.id !== INHERIT_TRANSLATION_PRESET_ID);
              setCustom([
                ...custom,
                {
                  id,
                  name: t("translationPanel.newPresetName", { number: custom.length + 1 }),
                  prompt: literary?.prompt ?? "",
                  replace: true,
                },
              ]);
              setManaged(id);
              setEditing({ id, creating: true, snapshot: null });
            }}
          >
            {t("translationPanel.newPreset")}
          </button>
          <button
            type="button"
            className={UI.button}
            disabled={managedPreset.builtin || editing?.creating || save.isPending}
            onClick={async () => {
              if (
                !(await showConfirmDialog({
                  title: t("translationPanel.deletePreset"),
                  message: t("translationPanel.deletePresetConfirm", { name: managedPreset.name }),
                  tone: "destructive",
                }))
              )
                return;
              const nextPresets = custom.filter((row) => row.id !== managedPreset.id);
              // Rooms that used the preset fall back to keeping their own prompt.
              const clear = (value: Room): Room => ({
                ...value,
                presetId: value.presetId === managedPreset.id ? null : value.presetId,
                outgoingPresetId: value.outgoingPresetId === managedPreset.id ? null : value.outgoingPresetId,
              });
              const base = query.data ?? draft;
              const next = {
                ...base,
                translation: {
                  ...base.translation,
                  presets: nextPresets,
                  defaults: clear(base.translation.defaults),
                  rooms: Object.fromEntries(
                    Object.entries(base.translation.rooms).map(([id, value]) => [id, clear(value)]),
                  ),
                },
              };
              if (await persist(next, t("translationPanel.deleted"))) {
                setManaged(INHERIT_TRANSLATION_PRESET_ID);
                setEditing(null);
              }
            }}
          >
            {t("translationPanel.delete")}
          </button>
          {editing && (
            <button
              type="button"
              className={UI.button}
              onClick={() => {
                if (editing.creating) setCustom(custom.filter((row) => row.id !== editing.id));
                else if (editing.snapshot) {
                  const snapshot = editing.snapshot;
                  setCustom(
                    custom.map((row) =>
                      row.id === editing.id ? { ...row, name: snapshot.name, prompt: snapshot.prompt } : row,
                    ),
                  );
                }
                setEditing(null);
                setManaged(INHERIT_TRANSLATION_PRESET_ID);
                setStatus({ text: "", kind: "info" });
              }}
            >
              {t(editing.creating ? "translationPanel.cancelCreate" : "translationPanel.cancelEdit")}
            </button>
          )}
        </div>
      </Group>
      <div className="tpg-savebar">
        <span className={`tpg-status ${UI.help}`} data-kind={status.kind} role="status" aria-live="polite">
          {status.text}
        </span>
        <button type="submit" className={UI.save} disabled={save.isPending}>
          {save.isPending ? t("translationPanel.savingShort") : t("reader.save")}
        </button>
      </div>
      <Modal
        open={scanning !== null}
        onClose={() => {
          scanRun.current += 1;
          setScanning(null);
        }}
        title={t(`translationPanel.scan.${scanning ?? "glossary"}`)}
        width="max-w-md"
      >
        <p role="status" className="p-4 text-xs">
          {t(`translationPanel.scanning.${scanning ?? "glossary"}`)}
        </p>
      </Modal>
      <Modal open={review !== null} onClose={() => setReview(null)} title={review?.title ?? ""} width="max-w-2xl">
        {review && (
          <div className="space-y-2 p-4">
            <p className={UI.help}>{t("translationPanel.reviewHelp")}</p>
            <ReviewRows
              rows={review.rows}
              onConfirm={(picked) => {
                if (picked.length) {
                  review.apply(picked);
                  setStatus({ text: t("translationPanel.reviewAdded"), kind: "success" });
                }
                setReview(null);
              }}
            />
          </div>
        )}
      </Modal>
      <Modal
        open={world !== null}
        onClose={() => setWorld(null)}
        title={t("translationPanel.worldResult")}
        width="max-w-2xl"
      >
        {world !== null && (
          <div className="space-y-3 p-4">
            <p className={UI.help}>{t("translationPanel.worldHelp")}</p>
            <textarea
              className={UI.textarea}
              rows={16}
              spellCheck={false}
              aria-label={t("translationPanel.worldResult")}
              value={world}
              onChange={(event) => setWorld(event.target.value)}
            />
            <div className="flex flex-wrap justify-end gap-2">
              {room.freeContext.trim() && (
                <button
                  type="button"
                  className={UI.button}
                  disabled={!world.trim()}
                  onClick={() => {
                    patchRoom({
                      freeContext: `${room.freeContext.trim()}\n\n${world.trim()}`.slice(0, FREE_CONTEXT_MAX),
                      freeContextEnabled: true,
                    });
                    setWorld(null);
                  }}
                >
                  {t("translationPanel.append")}
                </button>
              )}
              <button
                type="button"
                className={UI.save}
                disabled={!world.trim()}
                onClick={() => {
                  patchRoom({ freeContext: world.trim().slice(0, FREE_CONTEXT_MAX), freeContextEnabled: true });
                  setWorld(null);
                }}
              >
                {t(room.freeContext.trim() ? "translationPanel.overwrite" : "translationPanel.insert")}
              </button>
            </div>
          </div>
        )}
      </Modal>
      <Modal open={lore} onClose={() => setLore(false)} title={t("translationPanel.pickLore")} width="max-w-2xl">
        {lore && (
          <div className="p-4">
            <LorePicker
              value={room.loreEntries}
              onSave={(loreEntries) => {
                patchRoom({ loreEntries, freeContextEnabled: true });
                setLore(false);
              }}
            />
          </div>
        )}
      </Modal>
    </form>
  );
}

/** The extension's per-chat scope, so its import (and this panel's) reads the file back. */
function toExtensionScope(room: Room) {
  return {
    glossary: room.glossary.map((entry) => `${entry.source} = ${entry.target}`).join("\n"),
    freeContextEnabled: room.freeContextEnabled ?? !!(room.freeContext.trim() || room.loreEntries.length),
    freeContext: room.freeContext,
    loreEntries: room.loreEntries,
    incomingVoiceEnabled: room.voiceEnabled ?? !!room.style.trim(),
    incomingVoicePrompt: room.style,
    contextEnabled: room.contextEnabled ?? room.contextMessages > 0,
    contextIncludeOriginal: room.contextIncludeOriginal,
    contextIncludeTranslation: room.contextIncludeTranslation,
    contextIncludeUserInput: room.contextIncludeUserInput,
    contextMessageCount: Math.min(10, Math.max(1, room.contextMessages || 3)),
    outgoingPresetId: room.outgoingPresetId ?? INHERIT_TRANSLATION_PRESET_ID,
    incomingPresetId: room.presetId ?? INHERIT_TRANSLATION_PRESET_ID,
    outgoingOriginalPrompt: room.outgoingOriginalPrompt ?? "",
    incomingOriginalPrompt: room.incomingOriginalPrompt ?? "",
  };
}
