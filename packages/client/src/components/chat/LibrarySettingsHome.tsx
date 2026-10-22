import { lazy, Suspense, useState } from "react";
import { ArrowLeft, ChevronRight, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUIStore, type Panel } from "../../stores/ui.store";

const Speech = lazy(() =>
  import("../panels/settings/TTSConfigCard").then((module) => ({
    default: function SpeechSettings() {
      return <module.TTSConfigCard defaultExpanded />;
    },
  })),
);
const Queue = lazy(() =>
  import("../panels/settings/NaiQueueSettings").then((module) => ({ default: module.NaiQueueSettings })),
);
const Extensions = lazy(() =>
  import("../panels/settings/PersonalExtensionsSettings").then((module) => ({
    default: module.PersonalExtensionsSettings,
  })),
);
const NaiPrompt = lazy(() =>
  import("./NaiCharacterPromptTool").then((module) => ({ default: module.NaiCharacterPromptTool })),
);
const Weather = lazy(() =>
  import("./NativeIntegrationSettings").then((module) => ({
    default: () => <module.NativeIntegrationSettings kind="weather" />,
  })),
);
const GlobalPreset = lazy(() =>
  import("./NativeIntegrationSettings").then((module) => ({
    default: () => <module.NativeIntegrationSettings kind="globalPreset" />,
  })),
);
const KeyVault = lazy(() =>
  import("../connections/ConnectionKeyVault").then((module) => ({ default: module.ConnectionKeyVault })),
);
const FEATURES = {
  speech: Speech,
  queue: Queue,
  extensions: Extensions,
  naiPrompt: NaiPrompt,
  weather: Weather,
  globalPreset: GlobalPreset,
  keyVault: KeyVault,
};
type Feature = keyof typeof FEATURES;

export function LibrarySettingsHome() {
  const { t } = useTranslation();
  const [feature, setFeature] = useState<Feature | null>(null);
  const row =
    "flex min-h-14 w-full items-center justify-between gap-3 border-b border-[var(--border)] py-3 text-left text-sm hover:bg-[var(--secondary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]";
  if (feature) {
    const Component = FEATURES[feature];
    return (
      <div className="py-4">
        <button
          type="button"
          className="mb-4 flex min-h-11 items-center gap-2 text-sm"
          onClick={() => setFeature(null)}
        >
          <ArrowLeft size={18} />
          {t("settingsHub.back")}
        </button>
        <h2 className="mb-5 text-lg font-semibold">{t(`settingsHub.${feature}`)}</h2>
        <Suspense
          fallback={
            <div role="status" aria-label={t("libraryShell.loading")}>
              <Loader2 className="animate-spin" />
            </div>
          }
        >
          <Component />
        </Suspense>
      </div>
    );
  }
  const resources: Panel[] = ["characters", "personas", "connections", "presets", "lorebooks", "agents"];
  return (
    <div className="pb-6">
      <h2 className="pb-2 pt-5 text-xs font-semibold text-[var(--muted-foreground)]">{t("settingsHub.resources")}</h2>
      {resources.map((panel) => (
        <button key={panel} type="button" className={row} onClick={() => useUIStore.getState().openRightPanel(panel)}>
          {t(`settingsHub.${panel}`)}
          <ChevronRight size={16} />
        </button>
      ))}
      <h2 className="pb-2 pt-7 text-xs font-semibold text-[var(--muted-foreground)]">{t("settingsHub.tools")}</h2>
      {(Object.keys(FEATURES) as Feature[]).map((item) => (
        <button key={item} type="button" className={row} onClick={() => setFeature(item)}>
          {t(`settingsHub.${item}`)}
          <ChevronRight size={16} />
        </button>
      ))}
      <h2 className="pb-2 pt-7 text-xs font-semibold text-[var(--muted-foreground)]">{t("settingsHub.preferences")}</h2>
      {["general", "appearance", "generations", "import", "advanced"].map((tab) => (
        <button
          key={tab}
          type="button"
          className={row}
          onClick={() => {
            useUIStore.getState().setSettingsTab(tab);
            useUIStore.getState().openRightPanel("settings");
          }}
        >
          {t(`settingsHub.${tab}`)}
          <ChevronRight size={16} />
        </button>
      ))}
    </div>
  );
}
