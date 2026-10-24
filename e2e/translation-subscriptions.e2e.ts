import { expect, test } from "@playwright/test";
import { prepareViteFixtureDependencies } from "./vite-fixture-dependencies.js";

test("translation updates notify only their message subscribers", async ({ page }) => {
  // Use the real hooks/store in an isolated React tree, without the application's other subscriptions.
  await page.route("/", (route) => route.fulfill({ contentType: "text/html", body: "<html><body></body></html>" }));
  await page.goto("/");
  await prepareViteFixtureDependencies(page);
  const proof = await page.evaluate(async () => {
    const url = window.__viteFixtureDependencyUrl;
    const { default: React } = await import(url("react"));
    const { default: ReactDOM } = await import(url("react-dom_client"));
    const { QueryClient, QueryClientProvider } = await import(url("@tanstack_react-query"));
    const { useMessageTranslation, useTranslate } = await import("/src/hooks/use-translate.ts" as string);
    const { useTranslationStore } = await import("/src/stores/translation.store.ts" as string);
    const counts: Record<string, number> = {};
    const values: Record<string, unknown> = {};
    const scope = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    scope.IS_REACT_ACT_ENVIRONMENT = true;
    const mount = document.createElement("div");
    document.body.append(mount);
    const root = ReactDOM.createRoot(mount);
    const client = new QueryClient();
    let selected = "0";
    function Message({ id }: { id: string }) {
      const { translatedText, translationSource, isTranslating } = useMessageTranslation(id);
      counts[id] = (counts[id] ?? 0) + 1;
      values[id] = { translatedText: translatedText ?? null, translationSource: translationSource ?? null, isTranslating };
      return null;
    }
    function Legacy() {
      const { translations } = useTranslate();
      counts.legacy = (counts.legacy ?? 0) + 1;
      values.legacy = translations[selected];
      return null;
    }
    const render = () => root.render(React.createElement(QueryClientProvider, { client }, [
      ...Array.from({ length: 20 }, (_, index) => React.createElement(Message, { key: index, id: index === 0 ? selected : String(index) })),
      React.createElement(Legacy, { key: "legacy" }),
    ]));
    const snapshots: Array<{ name: string; counts: Record<string, number>; values: Record<string, unknown> }> = [];
    const step = async (name: string, change: () => void) => {
      await React.act(change);
      snapshots.push({ name, counts: { ...counts }, values: { ...values } });
    };
    try {
      await step("mount", render);
      await step("start", () => useTranslationStore.getState().setTranslating("0", true));
      await step("result", () => useTranslationStore.getState().setTranslation("0", "번역", "source"));
      await step("finish", () => useTranslationStore.getState().setTranslating("0", false));
      await step("unrelated config", () => useTranslationStore.getState().setConfig({
        provider: "google", inputTargetLanguage: "en", outputTargetLanguage: "ko",
      }));
      await step("hide", () => useTranslationStore.getState().removeTranslation("0"));
      await step("seed", () => useTranslationStore.getState().seedFromMessages([
        { id: "1", content: "original", extra: { translation: "저장된 번역", translationSource: "original" } },
      ]));
      await step("invalidate", () => useTranslationStore.getState().invalidateTranslation("1"));
      await step("clear", () => useTranslationStore.getState().clearAll());
      // Reusing a mounted subscriber for a different message must follow the new ID.
      selected = "1";
      await step("switch ID", render);
      await step("old ID", () => useTranslationStore.getState().setTranslation("0", "old", "old source"));
      await step("new ID", () => useTranslationStore.getState().setTranslation("1", "new", "new source"));
      return snapshots;
    } finally {
      await React.act(() => root.unmount());
      client.clear();
      mount.remove();
      delete scope.IS_REACT_ACT_ENVIRONMENT;
    }
  });
  const at = (name: string) => proof.find((row) => row.name === name)!;
  const initial = at("mount").counts;
  for (const row of proof.slice(0, proof.findIndex((row) => row.name === "switch ID"))) {
    for (let index = 2; index < 20; index++) expect(row.counts[String(index)]).toBe(initial[String(index)]);
  }
  expect(at("start").values["0"]).toEqual({ translatedText: null, translationSource: null, isTranslating: true });
  expect(at("result").values["0"]).toEqual({ translatedText: "번역", translationSource: "source", isTranslating: true });
  expect(at("result").values.legacy).toBe("번역");
  expect(at("finish").values["0"]).toEqual({ translatedText: "번역", translationSource: "source", isTranslating: false });
  expect(at("unrelated config").counts["0"]).toBe(at("finish").counts["0"]);
  expect(at("hide").values["0"]).toEqual({ translatedText: null, translationSource: null, isTranslating: false });
  expect(at("seed").values["1"]).toEqual({ translatedText: "저장된 번역", translationSource: "original", isTranslating: false });
  expect(at("invalidate").values["1"]).toEqual({ translatedText: null, translationSource: null, isTranslating: false });
  expect(at("clear").counts["0"]).toBe(at("hide").counts["0"]);
  expect(at("old ID").counts["1"]).toBe(at("switch ID").counts["1"]);
  expect(at("new ID").values["1"]).toEqual({ translatedText: "new", translationSource: "new source", isTranslating: false });
});
