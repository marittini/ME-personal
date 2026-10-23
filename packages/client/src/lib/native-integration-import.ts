import { z } from "zod";
import {
  BUILTIN_TRANSLATION_PRESETS,
  TRANSLATION_PRESET_V2_UPGRADES,
  nativeIntegrationsSchema,
  translationRoomSchema,
  weatherLocationSchema,
  type NativeIntegrations,
} from "@marinara-engine/shared";
const object = z.record(z.unknown());
const record = (value: unknown) => object.parse(value);
const string = (value: unknown) => (typeof value === "string" ? value : "");
/** Import into a reviewable draft; never guess a room from its display name. */
export function importNativeIntegrationBackup(
  value: unknown,
  current: NativeIntegrations,
  chatId?: string,
): NativeIntegrations {
  const data = record(value);
  const next = structuredClone(current);
  if ("revision" in data && ("weather" in data || "translation" in data || "globalPreset" in data))
    return nativeIntegrationsSchema.parse({ ...data, revision: current.revision });
  if (data.kind === "translation-presets-glossary.backup" && data.v === 1) {
    const imported = z
      .array(z.object({ id: z.string(), name: z.string(), prompt: z.string() }))
      .max(200)
      .parse(data.presets ?? []);
    // Built-ins ship with the engine, so their ids always resolve and are never stored as custom presets.
    const builtinIds = new Set(BUILTIN_TRANSLATION_PRESETS.map((preset) => preset.id));
    const remap = new Map<string, string>();
    const known = new Map(next.translation.presets.map((preset) => [preset.id, preset]));
    for (const preset of imported) {
      const id = preset.id.trim();
      if (!id || !preset.name.trim() || !preset.prompt.trim() || builtinIds.has(id)) continue;
      // A saved copy of a prompt that later became a v2 built-in maps onto that built-in (extension 1.6.x upgrade).
      const v2 = TRANSLATION_PRESET_V2_UPGRADES.find((row) => row.sourceId === id);
      const builtin = v2 && BUILTIN_TRANSLATION_PRESETS.find((row) => row.id === v2.id);
      if (builtin && builtin.name === preset.name.trim() && builtin.prompt === preset.prompt) {
        remap.set(id, builtin.id);
        continue;
      }
      const previous = known.get(id);
      if (previous && previous.prompt !== preset.prompt)
        throw new Error("Conflicting preset ID; rename before importing");
      // Custom presets replaced the chat prompt in the extension; the language follows the chat unless set.
      known.set(id, { ...previous, id, name: preset.name.trim(), prompt: preset.prompt, replace: true });
    }
    next.translation.presets = [...known.values()];
    const scope = (value: unknown) => {
      const old = record(value);
      const glossary = string(old.glossary)
        .split(/\r?\n/)
        .filter((line) => line.indexOf("=") > 0)
        .map((line) => ({
          source: line.slice(0, line.indexOf("=")).trim(),
          target: line.slice(line.indexOf("=") + 1).trim(),
          notes: "",
        }));
      const resolve = (value: unknown) => {
        const id = remap.get(string(value)) ?? string(value);
        return known.has(id) || builtinIds.has(id) ? id : null;
      };
      return translationRoomSchema.parse({
        presetId: resolve(old.incomingPresetId),
        outgoingPresetId: resolve(old.outgoingPresetId),
        glossary,
        style: old.incomingVoiceEnabled ? string(old.incomingVoicePrompt) : "",
        freeContext: old.freeContextEnabled ? string(old.freeContext) : "",
        loreEntries: old.freeContextEnabled ? (old.loreEntries ?? []) : [],
        // Same defaults and 1-10 range as the extension's normalizeScope.
        contextMessages: old.contextEnabled
          ? Math.min(10, Math.max(1, Number.parseInt(String(old.contextMessageCount ?? ""), 10) || 3))
          : 0,
        contextIncludeOriginal: old.contextIncludeOriginal !== false,
        contextIncludeTranslation: old.contextIncludeTranslation !== false,
        contextIncludeUserInput: old.contextIncludeUserInput === true,
      });
    };
    if (data.type === "chat") {
      if (!chatId) throw new Error("Select the destination room first");
      next.translation.rooms[chatId] = scope(data.scope);
    } else if (data.type === "all") {
      next.translation.defaults = scope(data.defaults ?? {});
      for (const [id, value] of Object.entries(record(data.chats ?? {}))) next.translation.rooms[id] = scope(value);
    } else throw new Error("Unknown backup type");
    return nativeIntegrationsSchema.parse(next);
  }
  if ("weatherSettings" in data || "userLocation" in data || "roomIds" in data) {
    const old = record(data.weatherSettings ?? data);
    const location = (value: unknown) => (value == null ? null : weatherLocationSchema.parse(value));
    const rooms: NativeIntegrations["weather"]["rooms"] = {};
    for (const [id, value] of Object.entries(record(old.rooms ?? {}))) {
      const room = record(value);
      rooms[id] = { enabled: room.enabled !== false, characterLocation: location(room.characterLocation) };
    }
    for (const id of z.array(z.string()).parse(old.roomIds ?? []))
      rooms[id] ??= { enabled: true, characterLocation: null };
    next.weather = { enabled: old.enabled !== false, userLocation: location(old.userLocation ?? old.location), rooms };
    return nativeIntegrationsSchema.parse(next);
  }
  if ("globalPresetId" in data && "setupDone" in data) {
    const rooms = next.globalPreset.rooms;
    for (const id of z.array(z.string()).parse(data.globalRooms ?? []))
      rooms[id] = { mode: "follow", presetId: null, presetName: "" };
    for (const id of z.array(z.string()).parse(data.noneRooms ?? []))
      rooms[id] = { mode: "none", presetId: null, presetName: "" };
    const names = record(data.knownPresets ?? {});
    for (const [id, pin] of Object.entries(record(data.pins ?? {})))
      if (typeof pin === "string") rooms[id] = { mode: "fixed", presetId: pin, presetName: string(names[pin]) };
    next.globalPreset = {
      ...next.globalPreset,
      enabled: data.setupDone === true,
      presetId: string(data.globalPresetId) || null,
      presetName: string(data.globalPresetName),
      modes: z.array(z.enum(["roleplay", "conversation"])).parse(data.modes ?? ["roleplay"]),
      rooms,
    };
    return nativeIntegrationsSchema.parse(next);
  }
  throw new Error("Unsupported backup format");
}
