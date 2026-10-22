import { TranslationLorePicker } from "./TranslationLorePicker";
import { importNativeIntegrationBackup } from "../../lib/native-integration-import";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { type NativeIntegrations, type WeatherLocation } from "@marinara-engine/shared";
import {
  useNativeIntegrations,
  useSaveNativeIntegrations,
  useWeatherPlaces,
  useWeatherPreview,
  useApplyGlobalPreset,
  useExtractTranslationGlossary,
} from "../../hooks/use-native-integrations";
import { useChats } from "../../hooks/use-chats";
import { usePresets } from "../../hooks/use-presets";
import { useConnections } from "../../hooks/use-connections";
import { downloadJsonFile } from "../../lib/download-json";
import { generateClientId } from "../../lib/utils";
import { showConfirmDialog } from "../../lib/app-dialogs";

import { INTEGRATION_INPUT, INTEGRATION_BUTTON } from "./IntegrationControls";

function LocationPicker({
  value,
  onChange,
}: {
  value: WeatherLocation | null;
  onChange: (value: WeatherLocation | null) => void;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [worldwide, setWorldwide] = useState(false);
  const places = useWeatherPlaces(query, worldwide);
  const preview = useWeatherPreview();
  return (
    <div className="space-y-2">
      {value && <p className="text-sm">{value.label}</p>}
      <div className="flex gap-2">
        <input
          aria-label={t("integrations.placeSearch")}
          className={INTEGRATION_INPUT}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <button className={INTEGRATION_BUTTON} type="button" onClick={() => setQuery(text.trim())}>
          {t("integrations.search")}
        </button>
      </div>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input type="checkbox" checked={worldwide} onChange={(e) => setWorldwide(e.target.checked)} />
        {t("integrations.worldwide")}
      </label>
      {places.isError && <p role="alert">{t("integrations.weatherError")}</p>}
      <select
        aria-label={t("integrations.place")}
        className={INTEGRATION_INPUT}
        value=""
        onChange={(e) => {
          const place = places.data?.[Number(e.target.value)];
          if (place) onChange(place);
        }}
      >
        <option value="">{t("integrations.selectPlace")}</option>
        {places.data?.map((place, index) => (
          <option key={`${place.latitude},${place.longitude}`} value={index}>
            {place.label}
          </option>
        ))}
      </select>
      {value && (
        <div className="flex gap-2">
          <button className={INTEGRATION_BUTTON} type="button" onClick={() => onChange(null)}>
            {t("integrations.clear")}
          </button>
          <button
            className={INTEGRATION_BUTTON}
            type="button"
            disabled={preview.isPending}
            onClick={() => preview.mutate(value, { onError: () => toast.error(t("integrations.weatherError")) })}
          >
            {t("integrations.weatherPreview")}
          </button>
        </div>
      )}
      {preview.data && (
        <p className="whitespace-pre-line text-xs text-[var(--muted-foreground)]">{preview.data.summary}</p>
      )}
    </div>
  );
}

export function NativeIntegrationSettings({ kind }: { kind: "weather" | "translation" | "globalPreset" }) {
  const { t } = useTranslation();
  const query = useNativeIntegrations();
  const save = useSaveNativeIntegrations();
  const chats = useChats();
  const presets = usePresets();
  const connections = useConnections();
  const apply = useApplyGlobalPreset();
  const [draft, setDraft] = useState<NativeIntegrations | null>(null);
  const [dirty, setDirty] = useState(false);
  const [chatId, setChatId] = useState("");
  const extract = useExtractTranslationGlossary();
  const [sample, setSample] = useState("");
  useEffect(() => {
    if (query.data && !dirty) setDraft(query.data);
  }, [query.data, dirty]);
  if (!draft)
    return (
      <div>
        <p role="status">{t(query.isError ? "integrations.loadError" : "integrations.loading")}</p>
        {query.isError && (
          <button type="button" className={INTEGRATION_BUTTON} onClick={() => void query.refetch()}>
            {t("integrations.reload")}
          </button>
        )}
      </div>
    );
  const patch = (next: NativeIntegrations) => {
    setDraft(next);
    setDirty(true);
  };
  const roomTranslation = draft.translation.rooms[chatId] ?? draft.translation.defaults;
  const roomWeather = draft.weather.rooms[chatId] ?? { enabled: false, characterLocation: null };
  const nativePresetId = chats.data?.find((chat) => chat.id === chatId)?.promptPresetId ?? null;
  const roomPreset = draft.globalPreset.rooms[chatId] ?? {
    mode: "fixed" as const,
    presetId: nativePresetId,
    presetName: presets.data?.find((preset) => preset.id === nativePresetId)?.name ?? "",
  };
  const updateTranslation = (next: typeof roomTranslation) =>
    patch({
      ...draft,
      translation: {
        ...draft.translation,
        ...(chatId ? { rooms: { ...draft.translation.rooms, [chatId]: next } } : { defaults: next }),
      },
    });
  const updateWeather = (next: typeof roomWeather) =>
    patch({ ...draft, weather: { ...draft.weather, rooms: { ...draft.weather.rooms, [chatId]: next } } });
  return (
    <div className="space-y-5">
      <p className="text-sm text-[var(--muted-foreground)]">{t(`integrations.${kind}Help`)}</p>
      {kind === "weather" && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.weather.enabled}
              onChange={(e) => patch({ ...draft, weather: { ...draft.weather, enabled: e.target.checked } })}
            />
            {t("integrations.enabled")}
          </label>
          <h3 className="text-sm font-semibold">{t("integrations.userLocation")}</h3>
          <LocationPicker
            value={draft.weather.userLocation}
            onChange={(userLocation) => patch({ ...draft, weather: { ...draft.weather, userLocation } })}
          />
          <a href="https://open-meteo.com/" target="_blank" rel="noreferrer" className="block text-xs underline">
            {t("integrations.weatherSource")}
          </a>
        </>
      )}
      {kind === "globalPreset" && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.globalPreset.enabled}
              onChange={(e) => patch({ ...draft, globalPreset: { ...draft.globalPreset, enabled: e.target.checked } })}
            />
            {t("integrations.enabled")}
          </label>
          <label className="block text-sm">
            {t("integrations.globalPreset")}
            <select
              className={INTEGRATION_INPUT}
              value={draft.globalPreset.presetId ?? ""}
              onChange={(e) =>
                patch({
                  ...draft,
                  globalPreset: {
                    ...draft.globalPreset,
                    presetId: e.target.value || null,
                    presetName: presets.data?.find((preset) => preset.id === e.target.value)?.name ?? "",
                  },
                })
              }
            >
              <option value="">{t("integrations.none")}</option>
              {presets.data?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <div className="flex flex-wrap gap-4">
            {(["roleplay", "conversation"] as const).map((mode) => (
              <label key={mode} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.globalPreset.modes.includes(mode)}
                  onChange={(e) =>
                    patch({
                      ...draft,
                      globalPreset: {
                        ...draft.globalPreset,
                        modes: e.target.checked
                          ? [...draft.globalPreset.modes, mode]
                          : draft.globalPreset.modes.filter((item) => item !== mode),
                      },
                    })
                  }
                />
                {t(`integrations.${mode}`)}
              </label>
            ))}
          </div>
        </>
      )}
      {kind === "translation" && (
        <>
          {draft.translation.presets.map((preset, index) => (
            <div key={preset.id} className="space-y-2 border-b border-[var(--border)] pb-4">
              <input
                aria-label={t("integrations.presetName")}
                className={INTEGRATION_INPUT}
                value={preset.name}
                onChange={(e) =>
                  patch({
                    ...draft,
                    translation: {
                      ...draft.translation,
                      presets: draft.translation.presets.map((row, i) =>
                        i === index ? { ...row, name: e.target.value } : row,
                      ),
                    },
                  })
                }
              />
              <textarea
                aria-label={t("integrations.translationPrompt")}
                className={INTEGRATION_INPUT}
                rows={4}
                value={preset.prompt}
                onChange={(e) =>
                  patch({
                    ...draft,
                    translation: {
                      ...draft.translation,
                      presets: draft.translation.presets.map((row, i) =>
                        i === index ? { ...row, prompt: e.target.value } : row,
                      ),
                    },
                  })
                }
              />
              <input
                aria-label={t("integrations.targetLanguage")}
                className={INTEGRATION_INPUT}
                value={preset.targetLanguage}
                onChange={(e) =>
                  patch({
                    ...draft,
                    translation: {
                      ...draft.translation,
                      presets: draft.translation.presets.map((row, i) =>
                        i === index ? { ...row, targetLanguage: e.target.value } : row,
                      ),
                    },
                  })
                }
              />
              <select
                aria-label={t("integrations.connection")}
                className={INTEGRATION_INPUT}
                value={preset.connectionId ?? ""}
                onChange={(e) =>
                  patch({
                    ...draft,
                    translation: {
                      ...draft.translation,
                      presets: draft.translation.presets.map((row, i) =>
                        i === index ? { ...row, connectionId: e.target.value || undefined } : row,
                      ),
                    },
                  })
                }
              >
                <option value="">{t("integrations.keepConnection")}</option>
                {(connections.data as Array<{ id: string; name: string }> | undefined)?.map((connection) => (
                  <option key={connection.id} value={connection.id}>
                    {connection.name}
                  </option>
                ))}
              </select>
              <button
                className={INTEGRATION_BUTTON}
                type="button"
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: t("integrations.remove"),
                      message: preset.name,
                      tone: "destructive",
                    })
                  )
                    patch({
                      ...draft,
                      translation: {
                        ...draft.translation,
                        presets: draft.translation.presets.filter((row) => row.id !== preset.id),
                      },
                    });
                }}
              >
                {t("integrations.remove")}
              </button>
            </div>
          ))}
          <button
            className={INTEGRATION_BUTTON}
            type="button"
            onClick={() =>
              patch({
                ...draft,
                translation: {
                  ...draft.translation,
                  presets: [
                    ...draft.translation.presets,
                    {
                      id: generateClientId(),
                      name: t("integrations.newPreset"),
                      prompt:
                        "Translate faithfully into {{targetLanguage}}. Preserve all markup and audio delivery tags. Return only the translation.",
                      targetLanguage: "Korean",
                    },
                  ],
                },
              })
            }
          >
            {t("integrations.addPreset")}
          </button>
        </>
      )}
      <label className="block text-sm">
        {t("integrations.room")}
        <select className={INTEGRATION_INPUT} value={chatId} onChange={(e) => setChatId(e.target.value)}>
          <option value="">
            {t(kind === "translation" ? "integrations.translationDefaults" : "integrations.selectRoom")}
          </option>
          {chats.data
            ?.filter((chat) => kind !== "weather" || chat.mode === "conversation")
            .map((chat) => (
              <option key={chat.id} value={chat.id}>
                {chat.name}
              </option>
            ))}
        </select>
      </label>
      {chatId && kind === "weather" && (
        <>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={roomWeather.enabled}
              onChange={(e) => updateWeather({ ...roomWeather, enabled: e.target.checked })}
            />
            {t("integrations.roomEnabled")}
          </label>
          <h3 className="text-sm font-semibold">{t("integrations.characterLocation")}</h3>
          <LocationPicker
            value={roomWeather.characterLocation}
            onChange={(characterLocation) => updateWeather({ ...roomWeather, characterLocation })}
          />
        </>
      )}
      {chatId && kind === "globalPreset" && (
        <>
          <select
            aria-label={t("integrations.roomPolicy")}
            className={INTEGRATION_INPUT}
            value={roomPreset.mode}
            onChange={(e) =>
              patch({
                ...draft,
                globalPreset: {
                  ...draft.globalPreset,
                  rooms: {
                    ...draft.globalPreset.rooms,
                    [chatId]: { ...roomPreset, mode: e.target.value as typeof roomPreset.mode },
                  },
                },
              })
            }
          >
            {["follow", "fixed", "none"].map((mode) => (
              <option key={mode} value={mode}>
                {t(`integrations.${mode}`)}
              </option>
            ))}
          </select>
          {roomPreset.mode === "fixed" && (
            <select
              aria-label={t("integrations.fixedPreset")}
              className={INTEGRATION_INPUT}
              value={roomPreset.presetId ?? ""}
              onChange={(e) =>
                patch({
                  ...draft,
                  globalPreset: {
                    ...draft.globalPreset,
                    rooms: {
                      ...draft.globalPreset.rooms,
                      [chatId]: {
                        ...roomPreset,
                        presetId: e.target.value || null,
                        presetName: presets.data?.find((preset) => preset.id === e.target.value)?.name ?? "",
                      },
                    },
                  },
                })
              }
            >
              <option value="">{t("integrations.none")}</option>
              {presets.data?.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {kind === "translation" && (
        <>
          <select
            aria-label={t("integrations.translationPreset")}
            className={INTEGRATION_INPUT}
            value={roomTranslation.presetId ?? ""}
            onChange={(e) => updateTranslation({ ...roomTranslation, presetId: e.target.value || null })}
          >
            <option value="">{t("integrations.keepTranslation")}</option>
            {draft.translation.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          <label className="block text-sm">
            {t("integrations.inputPreset")}
            <select
              className={INTEGRATION_INPUT}
              value={roomTranslation.outgoingPresetId ?? ""}
              onChange={(e) => updateTranslation({ ...roomTranslation, outgoingPresetId: e.target.value || null })}
            >
              <option value="">{t("integrations.keepTranslation")}</option>
              {draft.translation.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            {t("integrations.translationContext")}
            <input
              type="number"
              className={INTEGRATION_INPUT}
              min={0}
              max={50}
              value={roomTranslation.contextMessages}
              onChange={(e) =>
                updateTranslation({
                  ...roomTranslation,
                  contextMessages: Math.max(0, Math.min(50, Number(e.target.value))),
                })
              }
            />
          </label>
          <textarea
            aria-label={t("integrations.speechStyle")}
            className={INTEGRATION_INPUT}
            rows={3}
            value={roomTranslation.style}
            onChange={(e) => updateTranslation({ ...roomTranslation, style: e.target.value })}
          />
          <textarea
            aria-label={t("integrations.worldContext")}
            className={INTEGRATION_INPUT}
            rows={3}
            value={roomTranslation.freeContext}
            onChange={(e) => updateTranslation({ ...roomTranslation, freeContext: e.target.value })}
          />
          <TranslationLorePicker
            value={roomTranslation.loreEntries}
            onChange={(loreEntries) => updateTranslation({ ...roomTranslation, loreEntries })}
          />
          <div className="space-y-1">
            {(["contextIncludeOriginal", "contextIncludeTranslation", "contextIncludeUserInput"] as const).map(
              (key) => (
                <label key={key} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={roomTranslation[key]}
                    onChange={(e) => updateTranslation({ ...roomTranslation, [key]: e.target.checked })}
                  />
                  {t(`integrations.${key}`)}
                </label>
              ),
            )}
          </div>
          <h3 className="text-sm font-semibold">{t("integrations.glossary")}</h3>
          {roomTranslation.glossary.map((entry, index) => (
            <div key={index} className="grid grid-cols-2 gap-2">
              {(["source", "target", "notes"] as const).map((field) => (
                <input
                  key={field}
                  className={INTEGRATION_INPUT}
                  aria-label={t(`integrations.${field}`)}
                  value={entry[field]}
                  onChange={(e) =>
                    updateTranslation({
                      ...roomTranslation,
                      glossary: roomTranslation.glossary.map((row, i) =>
                        i === index ? { ...row, [field]: e.target.value } : row,
                      ),
                    })
                  }
                />
              ))}
              <button
                className={INTEGRATION_BUTTON}
                type="button"
                onClick={() =>
                  updateTranslation({
                    ...roomTranslation,
                    glossary: roomTranslation.glossary.filter((_, i) => i !== index),
                  })
                }
              >
                {t("integrations.remove")}
              </button>
            </div>
          ))}
          <button
            className={INTEGRATION_BUTTON}
            type="button"
            onClick={() =>
              updateTranslation({
                ...roomTranslation,
                glossary: [...roomTranslation.glossary, { source: "", target: "", notes: "" }],
              })
            }
          >
            {t("integrations.addTerm")}
          </button>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("integrations.extractGlossary")}</summary>
            <textarea
              aria-label={t("integrations.sampleText")}
              className={INTEGRATION_INPUT}
              rows={4}
              value={sample}
              onChange={(e) => setSample(e.target.value)}
            />
            <button
              className={INTEGRATION_BUTTON}
              type="button"
              disabled={extract.isPending || !sample.trim() || dirty || !chatId}
              onClick={async () => {
                try {
                  const result = await extract.mutateAsync({ chatId, text: sample });
                  updateTranslation({
                    ...roomTranslation,
                    glossary: [
                      ...roomTranslation.glossary,
                      ...result.entries.filter(
                        (term) => !roomTranslation.glossary.some((old) => old.source === term.source),
                      ),
                    ],
                  });
                } catch {
                  toast.error(t("integrations.extractError"));
                }
              }}
            >
              {t("integrations.extract")}
            </button>
          </details>
        </>
      )}
      <div className="flex flex-wrap gap-2 border-t border-[var(--border)] pt-4">
        <button
          className={INTEGRATION_BUTTON}
          type="button"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(draft, {
              onSuccess: (next) => {
                setDraft(next);
                setDirty(false);
                toast.success(t("integrations.saved"));
              },
              onError: () => toast.error(t("integrations.saveConflict")),
            })
          }
        >
          {t("reader.save")}
        </button>
        <button
          className={INTEGRATION_BUTTON}
          type="button"
          onClick={() => {
            setDirty(false);
            void query.refetch();
          }}
        >
          {t("integrations.reload")}
        </button>
        <button
          className={INTEGRATION_BUTTON}
          type="button"
          onClick={() => void downloadJsonFile(draft, "marinara-integrations.json")}
        >
          {t("integrations.backup")}
        </button>
        <label className={INTEGRATION_BUTTON}>
          {t("integrations.restore")}
          <input
            className="hidden"
            type="file"
            accept="application/json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                if (file.size > 5_000_000) throw new Error("Backup too large");
                const imported = importNativeIntegrationBackup(
                  JSON.parse(await file.text()),
                  draft,
                  chatId || undefined,
                );
                if (
                  await showConfirmDialog({
                    title: t("integrations.restore"),
                    message: t("integrations.restoreConfirm"),
                  })
                )
                  patch({ ...imported, revision: draft.revision });
              } catch {
                toast.error(t("integrations.importError"));
              }
            }}
          />
        </label>
        {kind === "globalPreset" && (
          <button
            className={INTEGRATION_BUTTON}
            type="button"
            disabled={dirty || apply.isPending || !chats.data?.length}
            onClick={async () => {
              if (
                await showConfirmDialog({
                  title: t("integrations.applyAll"),
                  message: t("integrations.applyAllConfirm"),
                })
              )
                apply.mutate(
                  (chats.data ?? [])
                    .filter((chat) => draft.globalPreset.modes.includes(chat.mode as "roleplay" | "conversation"))
                    .map((chat) => chat.id),
                  {
                    onSuccess: ({ changed }) => toast.success(t("integrations.roomsChanged", { count: changed })),
                    onError: () => toast.error(t("integrations.saveError")),
                  },
                );
            }}
          >
            {t("integrations.applyAll")}
          </button>
        )}
      </div>
      {kind === "globalPreset" && (
        <details>
          <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("integrations.history")}</summary>
          {draft.globalPreset.history.map((entry, index) => (
            <p key={index} className="break-words border-b border-[var(--border)] py-2 text-xs">
              {entry.time} ·{" "}
              {chats.data?.find((chat) => chat.id === entry.chatId)?.name ?? t("integrations.deletedRoom")} ·{" "}
              {presets.data?.find((preset) => preset.id === entry.from)?.name ?? t("integrations.none")} →{" "}
              {presets.data?.find((preset) => preset.id === entry.to)?.name ?? t("integrations.none")}
            </p>
          ))}
        </details>
      )}
    </div>
  );
}
