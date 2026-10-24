import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isolateSyncedUISettings, seedUIState } from "./ui-state-fixture";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
async function setup(page: import("@playwright/test").Page) {
  await isolateSyncedUISettings(page);
  await seedUIState(
    page,
    {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      language: "ko",
      chatHelpSeenModes: ["roleplay", "conversation"],
    },
    "if-missing",
  );
  await page.addInitScript((version) => localStorage.setItem("marinara:whats-new:seen-version", version), version);
  await page.goto("/");
  await page.getByRole("navigation", { name: "서재 탐색" }).getByRole("button", { name: "설정", exact: true }).click();
}
test("native tools save weather room settings; My page leaves out speech, extensions and the key vault", async ({
  page,
  request,
}) => {
  const snapshot = await (await request.get("/api/native-integrations/settings")).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "통합 도구 검증", mode: "conversation", characterIds: [] } })
  ).json();
  try {
    await setup(page);
    await page.getByRole("button", { name: "대화 날씨", exact: true }).click();
    await page.getByRole("checkbox", { name: "사용", exact: true }).check();
    await page.getByRole("combobox", { name: "지역", exact: true }).selectOption("0");
    await page.getByRole("combobox", { name: "대화방", exact: true }).selectOption(chat.id);
    await page.getByRole("checkbox", { name: "이 방에 날씨 전달", exact: true }).check();
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/native-integrations/settings")).json()).weather.rooms[chat.id]?.enabled,
      )
      .toBe(true);
    await page.getByRole("button", { name: "마이페이지로 돌아가기", exact: true }).click();
    // My page leaves out Speech & calls (reachable from Connections), extension management and the key vault.
    for (const name of ["음성·통화 설정", "확장 관리", "연결 키 보관함"])
      await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "NovelAI 요청 대기열", exact: true })).toBeVisible();
    await page.screenshot({ path: `.tmp/native-tools-${test.info().project.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally {
    await request.post("/api/native-integrations/vault", { data: { action: "reset", password: "browser-master" } });
    const latest = await (await request.get("/api/native-integrations/settings")).json();
    await request.put("/api/native-integrations/settings", { data: { ...snapshot, revision: latest.revision } });
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
