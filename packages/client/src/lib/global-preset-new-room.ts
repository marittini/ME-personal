import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { toast } from "sonner";
import { nativeIntegrationsSchema, type Chat } from "@marinara-engine/shared";
import { api } from "./api-client";
import { showChoiceDialog } from "./app-dialogs";

/**
 * After a new room's setup wizard, ask whether it should follow the global preset, like the global preset
 * extension. "Later" leaves the room unrecorded; the server then fills a preset-less room with the global
 * preset at generation, keeps an existing own preset, and lets a roleplay connection preset win.
 */
export async function offerGlobalPresetForNewRoom(chatId: string, t: TFunction, queryClient: QueryClient) {
  const [settings, chat, presets] = await Promise.all([
    api.get("/native-integrations/settings").then((value) => nativeIntegrationsSchema.parse(value)),
    api.get<Chat>(`/chats/${chatId}`),
    api.get<Array<{ id: string; name: string }>>("/prompts"),
  ]);
  const global = settings.globalPreset;
  if (!global.enabled || !global.modes.includes(chat.mode as "roleplay" | "conversation")) return;
  if (global.rooms[chat.id] || !global.presetId) return;
  const presetName = (id: string | null | undefined) => presets.find((preset) => preset.id === id)?.name ?? "";
  if (chat.mode === "roleplay" && chat.connectionId) {
    const connection = await api.get<{ promptPresetId?: string | null }>(`/connections/${chat.connectionId}`);
    if (connection.promptPresetId) {
      toast(t("globalPreset.newRoomConnection", { name: presetName(connection.promptPresetId) }));
      return;
    }
  }
  const current = presetName(chat.promptPresetId) ? chat.promptPresetId! : null;
  const save = async (room: (typeof global.rooms)[string]) => {
    const next = { ...settings, globalPreset: { ...global, rooms: { ...global.rooms, [chat.id]: room } } };
    queryClient.setQueryData(["native-integrations"], await api.put("/native-integrations/settings", next));
  };
  if (current === global.presetId) {
    await save({ mode: "follow", presetId: null, presetName: "" });
    return;
  }
  const choice = await showChoiceDialog({
    title: t("globalPreset.newRoomTitle"),
    message: t("globalPreset.newRoomMessage", {
      room: chat.name,
      current: presetName(current) || t("globalPreset.none"),
      global: presetName(global.presetId) || global.presetName,
    }),
    cancelLabel: t("globalPreset.later"),
    choices: [
      { key: "global", label: t("globalPreset.applyGlobal") },
      { key: "keep", label: t(current ? "globalPreset.keepCurrent" : "globalPreset.keepNone") },
    ],
  });
  if (choice === "global") await save({ mode: "follow", presetId: null, presetName: "" });
  // Keeping its own preset needs no record; a room left without one is recorded as "none".
  else if (choice === "keep" && !current) await save({ mode: "none", presetId: null, presetName: "" });
}
