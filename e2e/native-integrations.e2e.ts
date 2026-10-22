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
  await page.getByRole("button", { name: "설정", exact: true }).click();
}
test("native tools save real room settings, encrypted keys and a rendered excerpt", async ({ page, request }) => {
  const snapshot = await (await request.get("/api/native-integrations/settings")).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "통합 도구 검증", mode: "conversation", characterIds: [] } })
  ).json();
  try {
    await setup(page);
    await page.getByRole("button", { name: "번역 프리셋·단어장", exact: true }).click();
    await page.getByRole("button", { name: "프리셋 추가", exact: true }).click();
    await page.getByRole("textbox", { name: "프리셋 이름", exact: true }).fill("원문 보존 검증");
    await page.getByRole("combobox", { name: "대화방", exact: true }).selectOption(chat.id);
    await page.getByRole("button", { name: "단어 추가", exact: true }).click();
    await page.getByRole("textbox", { name: "원어", exact: true }).fill("Alice");
    await page.getByRole("textbox", { name: "번역어", exact: true }).fill("앨리스");
    await page.getByRole("textbox", { name: "세계관·설정 참고", exact: true }).fill("서울을 배경으로 하는 이야기");
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/native-integrations/settings")).json()).translation.rooms[chat.id]
            ?.glossary[0]?.target,
      )
      .toBe("앨리스");
    await page.getByRole("button", { name: "마이페이지로 돌아가기", exact: true }).click();
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
    await page.getByRole("button", { name: "연결 키 보관함", exact: true }).click();
    await page.getByLabel("마스터 비밀번호 (4자 이상)", { exact: true }).fill("browser-master");
    const confirm = page.getByLabel("마스터 비밀번호 확인", { exact: true });
    if (await confirm.isVisible()) await confirm.fill("browser-master");
    await page.getByRole("button", { name: "보관함 열기·생성", exact: true }).click();
    await page.getByLabel("키 이름", { exact: true }).fill("모바일 키");
    await page.getByLabel("비밀 키", { exact: true }).fill("sk-browser-fixture");
    await page.getByRole("button", { name: "키 저장", exact: true }).click();
    await expect(page.getByText("모바일 키", { exact: true })).toBeVisible();
    expect(await page.locator("body").innerText()).not.toContain("sk-browser-fixture");
    await page.getByRole("button", { name: "잠그기", exact: true }).click();
    await expect(page.getByLabel("마스터 비밀번호 (4자 이상)", { exact: true })).toHaveValue("");
    await page.getByRole("button", { name: "마이페이지로 돌아가기", exact: true }).click();
    await page.getByRole("button", { name: "발췌 스튜디오", exact: true }).click();
    await page
      .getByRole("textbox", { name: "발췌할 글", exact: true })
      .fill("“한글 대사를 남깁니다.”\n긴 문장은 이미지 너비에 맞게 줄을 바꿉니다.");
    const canvas = page.getByLabel("발췌 이미지 미리보기", { exact: true });
    await expect.poll(() => canvas.evaluate((node) => (node as HTMLCanvasElement).width)).toBeGreaterThan(0);
    await expect(page.getByRole("button", { name: "PNG로 저장", exact: true })).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG로 저장", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("marinara-excerpt.png");
    await page.getByRole("button", { name: "꾸밈 설정 저장", exact: true }).click();
    await page.screenshot({ path: `.tmp/native-tools-${test.info().project.name}.png`, fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally {
    await request.post("/api/native-integrations/vault", { data: { action: "reset", password: "browser-master" } });
    const latest = await (await request.get("/api/native-integrations/settings")).json();
    await request.put("/api/native-integrations/settings", { data: { ...snapshot, revision: latest.revision } });
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
