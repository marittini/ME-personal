import assert from "node:assert/strict";
import { useUIStore, pickSyncedSettings } from "../../packages/client/src/stores/ui.store.js";
import { haveSyncedSettingsChanged } from "../../packages/client/src/hooks/use-settings-sync.js";

const initial = useUIStore.getInitialState();
const previous = pickSyncedSettings(initial);
const stringify = JSON.stringify;
let serializations = 0;
JSON.stringify = ((...args: Parameters<typeof JSON.stringify>) => {
  serializations++;
  return stringify(...args);
}) as typeof JSON.stringify;
try {
  // Changing a panel or another local/transient value must do no settings serialization.
  const unrelated = pickSyncedSettings({
    ...initial,
    rightPanelOpen: !initial.rightPanelOpen,
    settingsSyncReady: !initial.settingsSyncReady,
    chatFontSize: initial.chatFontSize + 1,
  });
  for (let index = 0; index < 100; index++) assert.equal(haveSyncedSettingsChanged(unrelated, previous), false);
  assert.equal(serializations, 0, "100 unrelated updates avoid the previous 200 JSON serializations");

  const changed = pickSyncedSettings({ ...initial, sidebarWidth: initial.sidebarWidth + 1 });
  assert.equal(haveSyncedSettingsChanged(changed, previous), true);
  assert.equal(serializations, 2, "a possible change still uses the original JSON comparison");

  const equivalent = structuredClone(previous);
  assert.equal(
    haveSyncedSettingsChanged(equivalent, previous),
    false,
    "new references with equal contents do not save",
  );

  // Derive coverage from the actual synced projection, including renamed/projected keys.
  for (const key of Object.keys(previous) as Array<keyof typeof previous>) {
    const candidate = { ...previous, [key]: { regression: key } };
    assert.equal(
      haveSyncedSettingsChanged(candidate, previous),
      stringify(candidate) !== stringify(previous),
      `${key} retains the original change decision`,
    );
  }
  for (const patch of [
    { customQuickReplies: [...initial.customQuickReplies, { label: "test", content: "test" }] },
    { libraryCustomizations: { test: { displayName: "이름", title: "제목", description: "설명" } } },
    { mariWindowWidthRem: Number.NaN },
    { omnibarWindowHeightRem: Number.POSITIVE_INFINITY },
  ]) {
    const candidate = pickSyncedSettings({ ...initial, ...patch } as typeof initial);
    assert.equal(haveSyncedSettingsChanged(candidate, previous), stringify(candidate) !== stringify(previous));
  }
} finally {
  JSON.stringify = stringify;
}
console.info("Settings sync serialization regression passed: unrelated changes perform zero JSON serializations.");
