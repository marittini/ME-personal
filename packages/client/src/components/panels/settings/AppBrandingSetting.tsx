import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ImageUp, Loader2, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import {
  useAppBranding,
  useResetAppIcon,
  useSaveAppBrandingNames,
  useUploadAppIcon,
} from "../../../hooks/use-app-branding";
import { SETTINGS_BUTTON_CLASS } from "./SettingControls";

/** App name and icon: the browser tab, the favicon and the home-screen web app use them. */
export function AppBrandingSetting({ id }: { id: string }) {
  const { t } = useTranslation();
  const { data } = useAppBranding();
  const saveNames = useSaveAppBrandingNames();
  const uploadIcon = useUploadAppIcon();
  const resetIcon = useResetAppIcon();
  const fileInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");
  useEffect(() => {
    if (!data) return;
    setName(data.name);
    setShortName(data.shortName);
  }, [data]);
  const changed = !!data && (name.trim() !== data.name || shortName.trim() !== data.shortName);
  const fail = (error: unknown) => toast.error(error instanceof Error ? error.message : t("settings.branding.failed"));

  return (
    <div id={id} data-app-branding="" className="flex min-w-0 flex-col gap-2">
      <span className="text-xs font-medium">{t("settings.branding.title")}</span>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.branding.help")}</span>
      <div className="flex min-w-0 items-center gap-3">
        <img
          src={data?.icon?.large ?? "/icon-192.png"}
          alt={t("settings.branding.iconPreview")}
          className="h-12 w-12 shrink-0 rounded-xl border border-[var(--border)] object-cover"
        />
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className={SETTINGS_BUTTON_CLASS}
            disabled={uploadIcon.isPending}
            onClick={() => fileInput.current?.click()}
          >
            {uploadIcon.isPending ? <Loader2 size="0.75rem" className="animate-spin" /> : <ImageUp size="0.75rem" />}
            {t("settings.branding.chooseIcon")}
          </button>
          {data?.icon && (
            <button
              type="button"
              className={SETTINGS_BUTTON_CLASS}
              disabled={resetIcon.isPending}
              onClick={() => resetIcon.mutate(undefined, { onError: fail })}
            >
              <RotateCcw size="0.75rem" />
              {t("settings.branding.resetIcon")}
            </button>
          )}
        </div>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) uploadIcon.mutate(file, { onError: fail });
          }}
        />
      </div>
      <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem]">
        {t("settings.branding.name")}
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          placeholder={data?.effectiveName ?? "Marinara Engine"}
          className="mari-chrome-field h-9 w-full px-3 text-xs"
        />
      </label>
      <label className="flex min-w-0 flex-col gap-1 text-[0.6875rem]">
        {t("settings.branding.shortName")}
        <input
          value={shortName}
          maxLength={30}
          onChange={(event) => setShortName(event.target.value)}
          placeholder={data?.effectiveShortName ?? "Marinara"}
          className="mari-chrome-field h-9 w-full px-3 text-xs"
        />
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          className={SETTINGS_BUTTON_CLASS}
          disabled={!changed || saveNames.isPending}
          onClick={() =>
            saveNames.mutate(
              { name: name.trim(), shortName: shortName.trim() },
              { onSuccess: () => toast.success(t("settings.branding.saved")), onError: fail },
            )
          }
        >
          {saveNames.isPending && <Loader2 size="0.75rem" className="animate-spin" />}
          {t("settings.branding.save")}
        </button>
      </div>
      <span className="text-[0.625rem] text-[var(--muted-foreground)]">{t("settings.branding.installedNote")}</span>
    </div>
  );
}
