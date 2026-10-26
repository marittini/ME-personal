import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { ttsExtraParticipants, type Chat } from "@marinara-engine/shared";
import { useUpdateChatMetadata } from "../../hooks/use-chats";

type ExtraVoice = { id: string; name: string; voice: string; phonetic: string };

function newExtraId() {
  return `extra-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Voices for people in this story who have no card (an extra who turns up mid-scene). Saved with the room. With
 * speech guidance on, the model wraps their lines with their id like any participant, and the reader speaks them
 * in the voice given here; an empty voice uses the default one.
 */
export function ReaderExtraVoices({ chat }: { chat: Chat }) {
  const { t } = useTranslation();
  const update = useUpdateChatMetadata({ serialize: true });
  const saved = ttsExtraParticipants(chat.metadata.ttsExtraVoices).map(({ id, name, voice, phonetic }) => ({
    id,
    name,
    voice,
    phonetic,
  }));
  const savedKey = JSON.stringify(saved);
  const [rows, setRows] = useState<ExtraVoice[]>(saved);
  // A save elsewhere (another tab, a settings profile) replaces the draft.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => setRows(saved), [savedKey]);
  const cleaned = rows
    .map((row) => ({ ...row, name: row.name.trim(), voice: row.voice.trim(), phonetic: row.phonetic.trim() }))
    .filter((row) => row.name);
  const changed = JSON.stringify(cleaned) !== savedKey;
  const field = "mari-chrome-field h-10 min-w-0 px-3 text-sm";
  const patch = (index: number, value: Partial<ExtraVoice>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...value } : row)));

  return (
    <form
      className="space-y-2 text-sm"
      data-reader-extra-voices=""
      onSubmit={(event) => {
        event.preventDefault();
        update.mutate(
          // An empty phonetic name is left out, so rooms saved before it read the same.
          {
            id: chat.id,
            ttsExtraVoices: cleaned.map(({ phonetic, ...row }) => (phonetic ? { ...row, phonetic } : row)),
          },
          {
            onSuccess: () => toast.success(t("integrations.saved")),
            onError: () => toast.error(t("reader.speechSaveFailed")),
          },
        );
      }}
    >
      <span className="block">{t("reader.extraVoices")}</span>
      <p className="text-xs text-[var(--muted-foreground)]">{t("reader.extraVoicesHelp")}</p>
      {rows.map((row, index) => (
        // Name and how it is read on one line, the voice and remove on the next, so it fits a phone.
        <div key={row.id} className="grid grid-cols-[1fr_1fr_auto] gap-2" data-reader-extra-voice={row.id}>
          <input
            className={field}
            value={row.name}
            aria-label={t("reader.extraVoiceName", { number: index + 1 })}
            placeholder={t("reader.extraVoiceNamePlaceholder")}
            onChange={(event) => patch(index, { name: event.target.value })}
          />
          <input
            className={`${field} col-span-2`}
            value={row.phonetic}
            aria-label={t("reader.extraVoicePhonetic", { number: index + 1 })}
            placeholder={t("reader.extraVoicePhoneticPlaceholder")}
            onChange={(event) => patch(index, { phonetic: event.target.value })}
          />
          <input
            className={`${field} col-span-2`}
            value={row.voice}
            aria-label={t("reader.extraVoiceVoice", { number: index + 1 })}
            placeholder={t("reader.personaVoiceDefault")}
            onChange={(event) => patch(index, { voice: event.target.value })}
          />
          <button
            type="button"
            className="mari-chrome-control inline-flex h-10 w-10 shrink-0 items-center justify-center p-0"
            aria-label={t("reader.extraVoiceRemove", { name: row.name || index + 1 })}
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex gap-2">
        <button
          type="button"
          className="mari-chrome-control h-10 flex-1 text-sm"
          onClick={() => setRows((current) => [...current, { id: newExtraId(), name: "", voice: "", phonetic: "" }])}
        >
          <Plus size={14} />
          {t("reader.extraVoiceAdd")}
        </button>
        <button
          type="submit"
          className="mari-chrome-control h-10 shrink-0 px-4 text-sm disabled:opacity-50"
          disabled={update.isPending || !changed}
        >
          {t("reader.save")}
        </button>
      </div>
    </form>
  );
}
