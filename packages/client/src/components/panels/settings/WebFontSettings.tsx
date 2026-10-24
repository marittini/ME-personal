import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useSaveWebFontSettings, useWebFontSettings } from "../../../hooks/use-web-fonts";
import {
  EMPTY_WEB_FONT_SETTINGS,
  registeredFamilies,
  removeFamily,
  resolveWebFontCss,
  WebFontError,
} from "../../../lib/web-fonts";
import { SETTINGS_BUTTON_CLASS } from "./SettingControls";

/**
 * Web fonts (ported from the 웹폰트 매니저 extension): register @font-face / @import code and remove fonts. Registered
 * fonts are offered in every font picker — the app font above, the chat widget font, and each mode's font in the
 * chat's reading settings — so they are chosen where fonts were always chosen.
 */
export function WebFontSettings({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data } = useWebFontSettings();
  const save = useSaveWebFontSettings();
  const settings = data ?? EMPTY_WEB_FONT_SETTINGS;
  const webFamilies = useMemo(() => registeredFamilies(settings.css), [settings.css]);
  const [code, setCode] = useState("");
  const [registering, setRegistering] = useState(false);

  const fail = (error: unknown) =>
    toast.error(
      error instanceof WebFontError && (error.message === "invalid" || error.message === "limit")
        ? t(error.message === "invalid" ? "settings.webFonts.invalid" : "settings.webFonts.limit")
        : t("settings.webFonts.failed"),
    );
  const persist = (next: typeof settings, message: string) =>
    save.mutate(next, { onSuccess: () => toast.success(message), onError: fail });

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

  const busy = save.isPending || registering;
  return (
    <div id={id} data-web-fonts="" className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium">{t("settings.webFonts.title")}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.webFonts.help")}</span>
      {webFamilies.length === 0 ? (
        <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.webFonts.empty")}</span>
      ) : (
        <ul className="flex flex-col" aria-label={t("settings.webFonts.list")}>
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
                onClick={() =>
                  persist({ ...settings, css: removeFamily(settings.css, family) }, t("settings.webFonts.deleted"))
                }
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
