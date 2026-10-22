import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedUIState, isolateSyncedUISettings } from "./ui-state-fixture";

const COVER_PNG =
  "iVBORw0KGgoAAAANSUhEUgAAAHgAAAC0CAIAAADQLH9KAAABq0lEQVR4nO3QURFAQAAAUZRSQCcptLlcMsjgZ2+M9xLs7DrOY/ma695nJ7y2zQ74C6MjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGRx6tiASJHY0ZygAAAABJRU5ErkJggg==";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: independent cover crop and separated viewer survive reload`, async ({ page, request }) => {
    const character = await (
      await request.post("/api/characters", { data: { data: { name: `Cover owner ${mode}` } } })
    ).json();
    const chat = await (
      await request.post("/api/chats", { data: { name: `Cover ${mode}`, mode, characterIds: [character.id] } })
    ).json();
    try {
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", content: "A message in its own viewer." },
      });
      await isolateSyncedUISettings(page);
      await seedUIState(
        page,
        {
          hasCompletedOnboarding: true,
          sidebarOpen: false,
          rightPanelOpen: false,
          chatHelpSeenModes: ["roleplay", "conversation"],
          language: "ko",
          conversationMessageStyle: "classic",
        },
        "if-missing",
      );
      await page.addInitScript((id) => localStorage.setItem("marinara-active-chat-id", id), chat.id);
      await page.addInitScript((v) => localStorage.setItem("marinara:whats-new:seen-version", v), version);
      await page.goto("/");
      const workspace = page.locator('[data-component="ReaderWorkspace"]');
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      if (mode === "conversation") {
        await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
        await workspace.getByRole("button", { name: "읽기 설정", exact: true }).click();
        const viewer = page.getByRole("combobox", { name: "대화 뷰어", exact: true });
        await viewer.selectOption("classic");
        await expect(workspace.locator(".texting-bubble-other")).toHaveCount(0);
        await viewer.selectOption("bubble");
        await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(workspace.locator('[data-chat-mode="roleplay"]')).toBeVisible();
        await expect(workspace.locator(".texting-bubble-other")).toHaveCount(0);
      }
      await workspace.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
      const detail = page.locator('[data-component="LibraryWorkDetail"]');
      await expect(detail.getByRole("button", { name: "표지 편집", exact: true })).toHaveCount(0);
      await page.evaluate(async (id) => {
        const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
        useUIStore.getState().openCharacterDetail(id);
      }, character.id);
      const custom = page.locator('[data-component="CharacterLibraryCustomization"]');
      await custom.locator("summary").click();
      await custom.locator('input[type="file"]').setInputFiles({
        name: "independent.png",
        mimeType: "image/png",
        buffer: Buffer.from(COVER_PNG, "base64"),
      });
      await expect(custom.getByRole("img", { name: "표지 미리보기" })).toBeVisible();
      await custom.getByRole("slider", { name: "확대", exact: true }).fill("2");
      await custom.getByRole("slider", { name: "가로 위치", exact: true }).fill("0.8");
      await custom.getByRole("button", { name: "저장", exact: true }).click();
      const storedCharacter = await (await request.get(`/api/characters/${character.id}`)).json();
      expect(storedCharacter.avatarPath).toBeNull();
      await page.evaluate(async () => {
        const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
        useUIStore.getState().closeCharacterDetail();
      });
      const cover = detail.locator('img[src*="library-cover-"]');
      await expect(cover).toBeVisible();
      const source = await cover.getAttribute("src");
      const cropStyle = await cover.getAttribute("style");
      expect(source).toContain("w=320");
      await page.reload();
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      await workspace.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
      await expect(cover).toHaveAttribute("src", source!);
      await expect(cover).toHaveAttribute("style", cropStyle!);
      await detail.getByRole("button", { name: "이어 읽기", exact: true }).click();
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      if (mode === "conversation") await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
      await request.delete(`/api/characters/${character.id}`);
    }
  });
}

test("character editor isolates related works and preserves a cover draft when switching is cancelled", async ({
  page,
  request,
}) => {
  const characters: Array<{ id: string }> = [];
  const rooms: Array<{ id: string; name: string }> = [];
  try {
    for (const name of ["표지 A", "표지 B", "무관한 C"])
      characters.push(await (await request.post("/api/characters", { data: { data: { name } } })).json());
    for (const [name, cast] of [
      ["A와 B의 작품", [0, 1]],
      ["A와 C의 작품", [0, 2]],
      ["B와 C의 작품", [1, 2]],
    ] as const)
      rooms.push(
        await (
          await request.post("/api/chats", {
            data: { name, mode: "roleplay", characterIds: cast.map((index) => characters[index]!.id) },
          })
        ).json(),
      );
    await isolateSyncedUISettings(page);
    await seedUIState(
      page,
      { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false, language: "ko", theme: "light" },
      "if-missing",
    );
    await page.addInitScript((v) => localStorage.setItem("marinara:whats-new:seen-version", v), version);
    await page.goto("/");
    await page.evaluate(async (id) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().openCharacterDetail(id);
    }, characters[0]!.id);
    const custom = page.locator('[data-component="CharacterLibraryCustomization"]');
    await custom.locator("summary").click();
    const picker = custom.getByRole("combobox", { name: "꾸밀 작품", exact: true });
    await expect(picker.locator("option")).toHaveCount(3);
    await expect(picker.locator("option").filter({ hasText: "B와 C의 작품" })).toHaveCount(0);
    const group = `cast:${JSON.stringify([characters[0]!.id, characters[1]!.id].sort())}`;
    const other = `cast:${JSON.stringify([characters[0]!.id, characters[2]!.id].sort())}`;
    await picker.selectOption(group);
    await custom
      .locator('input[type="file"]')
      .setInputFiles({ name: "group.png", mimeType: "image/png", buffer: Buffer.from(COVER_PNG, "base64") });
    await expect(custom.getByRole("img", { name: "표지 미리보기" })).toBeVisible();
    await picker.selectOption(other);
    await page.getByRole("button", { name: "취소", exact: true }).last().click();
    await expect(picker).toHaveValue(group);
    await expect(custom.getByRole("img", { name: "표지 미리보기" })).toBeVisible();
    await custom.getByRole("button", { name: "저장", exact: true }).click();
    const keys = await page.evaluate(async () => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      return Object.keys(useUIStore.getState().libraryCovers);
    });
    expect(keys).toContain(group);
    expect(keys).not.toContain(other);
    await page.evaluate(async (id) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().openCharacterDetail(id);
    }, characters[1]!.id);
    await custom.locator("summary").click();
    await picker.selectOption(group);
    await expect(custom.getByRole("img", { name: "표지 미리보기" })).toBeVisible();
    await page.screenshot({ path: `.tmp/character-cover-${test.info().project.name}.png` });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  } finally {
    for (const room of rooms) await request.delete(`/api/chats/${room.id}?force=true`);
    for (const character of characters) await request.delete(`/api/characters/${character.id}`);
  }
});
