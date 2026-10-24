import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "../../../lib/api-client";
import { useSaveWebFontSettings, useWebFontSettings } from "../../../hooks/use-web-fonts";
import {
  EMPTY_WEB_FONT_SETTINGS,
  registeredFamilies,
  removeFamily,
  resolveWebFontCss,
  WEB_FONT_METRICS,
  WEB_FONT_TARGETS,
  WebFontError,
  type WebFontChoice,
  type WebFontMetric,
  type WebFontTarget,
} from "../../../lib/web-fonts";
import { cn } from "../../../lib/utils";
import { SETTINGS_BUTTON_CLASS } from "./SettingControls";

type CustomFontFace = { family: string };

const TARGET_LABEL: Record<WebFontTarget, string> = {
  ui: "settings.webFonts.targetUi",
  roleplay: "settings.webFonts.targetRoleplay",
  conversation: "settings.webFonts.targetConversation",
};

/**
 * Web fonts and per-target fonts (ported from the 웹폰트 매니저 extension): register @font-face / @import
 * code, then give the app UI, Roleplay messages and Conversation messages their own font, size,
 * letter spacing and line height.
 */
export function WebFontSettings({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data } = useWebFontSettings();
  const save = useSaveWebFontSettings();
  const settings = data ?? EMPTY_WEB_FONT_SETTINGS;
  const { data: engineFonts } = useQuery<CustomFontFace[]>({
    queryKey: ["custom-fonts"],
    queryFn: () => api.get("/fonts"),
    staleTime: Infinity,
  });
  const webFamilies = useMemo(() => registeredFamilies(settings.css), [settings.css]);
  const folderFamilies = useMemo(
    () => [...new Set((engineFonts ?? []).map((font) => font.family.trim()).filter(Boolean))],
    [engineFonts],
  );
  const [target, setTarget] = useState<WebFontTarget>("ui");
  const [draft, setDraft] = useState<WebFontChoice>({});
  useEffect(() => setDraft(settings.targets[target] ?? {}), [settings.targets, target]);
  const [code, setCode] = useState("");
  const [registering, setRegistering] = useState(false);

  const fail = (error: unknown) =>
    toast.error(
      error instanceof WebFontError && (error.message === "invalid" || error.message === "limit")
        ? t(error.message === "invalid" ? "settings.webFonts.invalid" : "settings.webFonts.limit")
        : t("settings.webFonts.failed"),
    );
  const persist = (next: typeof settings, message?: string) =>
    save.mutate(next, { onSuccess: () => message && toast.success(message), onError: fail });

  const step = (key: WebFontMetric, direction: 1 | -1) => {
    const metric = WEB_FONT_METRICS[key];
    const current = draft[key] ?? metric.initial;
    const next = Number(Math.min(metric.max, Math.max(metric.min, current + direction * metric.step)).toFixed(2));
    setDraft({ ...draft, [key]: next });
  };

  const apply = () => {
    const cleaned: WebFontChoice = Object.fromEntries(Object.entries(draft).filter(([, value]) => value !== undefined));
    const targets = { ...settings.targets };
    if (Object.keys(cleaned).length) targets[target] = cleaned;
    else delete targets[target];
    persist({ ...settings, targets }, t("settings.webFonts.saved"));
  };
  const reset = () => {
    const targets = { ...settings.targets };
    delete targets[target];
    setDraft({});
    persist({ ...settings, targets }, t("settings.webFonts.restored"));
  };

  const register = async () => {
    setRegistering(true);
    try {
      const css = await resolveWebFontCss(code);
      persist(
        { ...settings, css: [settings.css, css].filter((part) => part.trim()).join("\n") },
        t("settings.webFonts.registered"),
      );
      setCode("");
    } catch (error) {
      fail(error);
    } finally {
      setRegistering(false);
    }
  };

  const remove = (family: string) => {
    const targets = Object.fromEntries(
      Object.entries(settings.targets).map(([key, choice]) => [
        key,
        choice?.family === family ? { ...choice, family: undefined } : choice,
      ]),
    ) as typeof settings.targets;
    persist({ css: removeFamily(settings.css, family), targets }, t("settings.webFonts.deleted"));
  };

  const busy = save.isPending || registering;
  return (
    <div id={id} data-web-fonts="" className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium">{t("settings.webFonts.title")}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.webFonts.help")}</span>

      <div role="radiogroup" aria-label={t("settings.webFonts.target")} className="flex flex-wrap gap-1">
        {WEB_FONT_TARGETS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={target === value}
            onClick={() => setTarget(value)}
            className={cn(SETTINGS_BUTTON_CLASS, target === value && "mari-chrome-control--selected")}
          >
            {t(TARGET_LABEL[value])}
          </button>
        ))}
      </div>

      <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem]">
        {t("settings.webFonts.family")}
        <select
          value={draft.family ?? ""}
          onChange={(event) => setDraft({ ...draft, family: event.target.value || undefined })}
          className="mari-chrome-field h-9 w-full px-2 text-xs"
        >
          <option value="">{t("settings.webFonts.default")}</option>
          {webFamilies.length > 0 && (
            <optgroup label={t("settings.webFonts.webFontGroup")}>
              {webFamilies.map((family) => (
                <option key={`web:${family}`} value={family}>
                  {family}
                </option>
              ))}
            </optgroup>
          )}
          {folderFamilies.length > 0 && (
            <optgroup label={t("settings.webFonts.folderGroup")}>
              {folderFamilies.map((family) => (
                <option key={`folder:${family}`} value={family}>
                  {family}
                </option>
              ))}
            </optgroup>
          )}
          {draft.family && !webFamilies.includes(draft.family) && !folderFamilies.includes(draft.family) && (
            <option value={draft.family}>{t("settings.webFonts.unavailable", { family: draft.family })}</option>
          )}
        </select>
      </label>

      {target !== "ui" &&
        (Object.keys(WEB_FONT_METRICS) as WebFontMetric[]).map((key) => {
          const metric = WEB_FONT_METRICS[key];
          const value = draft[key];
          return (
            <div
              key={key}
              className="flex items-center justify-between gap-2 text-[0.6875rem]"
              data-web-font-metric={key}
            >
              <span>{t(`settings.webFonts.${key}`)}</span>
              <span className="flex items-center gap-1">
                <button
                  type="button"
                  className={SETTINGS_BUTTON_CLASS}
                  aria-label={t("settings.webFonts.decrease", { name: t(`settings.webFonts.${key}`) })}
                  disabled={value !== undefined && value <= metric.min}
                  onClick={() => step(key, -1)}
                >
                  <Minus size="0.75rem" />
                </button>
                <output className="min-w-12 text-center tabular-nums">
                  {value === undefined ? t("settings.webFonts.default") : `${value}${metric.unit}`}
                </output>
                <button
                  type="button"
                  className={SETTINGS_BUTTON_CLASS}
                  aria-label={t("settings.webFonts.increase", { name: t(`settings.webFonts.${key}`) })}
                  disabled={value !== undefined && value >= metric.max}
                  onClick={() => step(key, 1)}
                >
                  <Plus size="0.75rem" />
                </button>
              </span>
            </div>
          );
        })}

      <div className="flex flex-wrap gap-1.5">
        <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={apply}>
          {save.isPending && <Loader2 size="0.75rem" className="animate-spin" />}
          {t("settings.webFonts.apply")}
        </button>
        <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={busy} onClick={reset}>
          {t("settings.webFonts.reset")}
        </button>
      </div>

      <span className="mt-2 text-xs font-medium">{t("settings.webFonts.list")}</span>
      {webFamilies.length === 0 ? (
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.webFonts.empty")}</span>
      ) : (
        <ul className="flex flex-col">
          {webFamilies.map((family) => (
            <li
              key={family}
              data-web-font-family={family}
              className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-1.5 text-xs"
              style={{ fontFamily: JSON.stringify(family) }}
            >
              <span className="min-w-0 truncate">{family}</span>
              <button
                type="button"
                className={SETTINGS_BUTTON_CLASS}
                disabled={busy}
                aria-label={t("settings.webFonts.removeFamily", { family })}
                onClick={() => remove(family)}
              >
                <Trash2 size="0.75rem" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem]">
        {t("settings.webFonts.code")}
        <textarea
          value={code}
          onChange={(event) => setCode(event.target.value)}
          rows={4}
          spellCheck={false}
          placeholder={t("settings.webFonts.codePlaceholder")}
          className="mari-chrome-field min-h-20 w-full p-2 font-mono text-[0.6875rem]"
        />
      </label>
      <div>
        <button
          type="button"
          className={SETTINGS_BUTTON_CLASS}
          disabled={busy || !code.trim()}
          onClick={() => void register()}
        >
          {registering && <Loader2 size="0.75rem" className="animate-spin" />}
          {t("settings.webFonts.register")}
        </button>
      </div>
    </div>
  );
}
