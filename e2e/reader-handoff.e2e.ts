import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { isolateSyncedUISettings, seedUIState } from "./ui-state-fixture";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
async function open(page: Page, chatId: string) {
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
  await page.addInitScript(
    ({ chatId, version }) => {
      localStorage.setItem("marinara-active-chat-id", chatId);
      localStorage.setItem("marinara:whats-new:seen-version", version);
    },
    { chatId, version },
  );
  await page.goto("/");
  await expect(page.locator('[data-component="ReaderWorkspace"]')).toHaveAttribute("data-reader-enabled", "true");
}
for (const grouped of [false, true]) {
  test(`${grouped ? "group" : "convo"} paragraphs preserve newlines and align translations with safe fallback`, async ({
    page,
    request,
  }) => {
    const characters = [];
    for (const name of ["Alice", "Bob"])
      characters.push(await (await request.post("/api/characters", { data: { data: { name } } })).json());
    const chat = await (
      await request.post("/api/chats", {
        data: { name: "문단 검증", mode: "conversation", characterIds: grouped ? characters.map((c) => c.id) : [] },
      })
    ).json();
    try {
      const content = grouped
        ? "Alice: First paragraph.\nSame bubble.\n\nSecond paragraph.\nBob: Third paragraph."
        : "First paragraph.\nSame bubble.\n\nSecond paragraph.";
      const translation = grouped
        ? "첫 문단입니다.\n같은 말풍선.\n\n둘째 문단입니다.\n\n셋째 문단입니다."
        : "첫 문단입니다.\n같은 말풍선.\n\n둘째 문단입니다.";
      const message = await (
        await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "assistant", content } })
      ).json();
      await request.patch(`/api/chats/${chat.id}/messages/${message.id}/extra`, {
        data: { translation, translationSource: content, translationHidden: false },
      });
      await open(page, chat.id);
      const owner = page.locator(`[data-message-id="${message.id}"]`);
      const bubbles = owner.locator(".texting-bubble-other");
      await expect(bubbles).toHaveCount(grouped ? 3 : 2);
      await expect(bubbles.first()).toContainText("Same bubble.");
      await expect(bubbles.first()).toContainText("첫 문단입니다.");
      await expect(bubbles.nth(1)).toContainText("둘째 문단입니다.");
      expect(
        (await (await request.get(`/api/chats/${chat.id}/messages`)).json()).find(
          (m: { id: string }) => m.id === message.id,
        )?.content,
      ).toBe(content);
      await request.patch(`/api/chats/${chat.id}/messages/${message.id}/extra`, {
        data: { translation: "문단 수가 다른 전체 번역", translationSource: content },
      });
      await page.reload();
      await expect(owner.locator(".translation-text")).toHaveCount(1);
      await expect(bubbles.first().locator(".translation-text")).toHaveCount(0);
      await expect(owner).toContainText("문단 수가 다른 전체 번역");
      await page.screenshot({
        path: `.tmp/handoff-paragraphs-${grouped}-${test.info().project.name}.png`,
        fullPage: true,
      });
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
      for (const c of characters) await request.delete(`/api/characters/${c.id}`);
    }
  });
}
test("selection saves, edits, restores and deletes excerpts; native reader font and indent persist", async ({
  page,
  request,
}) => {
  const chat = await (
    await request.post("/api/chats", { data: { name: "발췌 검증", mode: "conversation", characterIds: [] } })
  ).json();
  const message = await (
    await request.post(`/api/chats/${chat.id}/messages`, {
      data: { role: "assistant", content: "한국어 문단을 저장합니다.\n\n日本語と English 문단입니다." },
    })
  ).json();
  try {
    await open(page, chat.id);
    const source = page.locator(`[data-message-id="${message.id}"] [data-tts-conversation-content]`).first();
    await source.evaluate((el) => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event("selectionchange"));
    });
    await page.getByRole("button", { name: "발췌 스튜디오", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "발췌할 글", exact: true })).toHaveValue(
      "한국어 문단을 저장합니다.",
    );
    await expect(page.getByRole("button", { name: "PNG로 저장", exact: true })).toBeEnabled();
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG로 저장", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toBe("marinara-excerpt.png");
    await page.getByRole("button", { name: "발췌 저장", exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata.readerExcerpts?.length)
      .toBe(1);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect.poll(() => page.evaluate(() => CSS.highlights.get("reader-excerpts")?.size ?? 0)).toBe(1);
    await page.getByRole("button", { name: "저장한 발췌", exact: true }).click();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    await page.getByRole("textbox", { name: "발췌할 글", exact: true }).fill("수정한 발췌");
    await page.getByRole("button", { name: "발췌 저장", exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata.readerExcerpts?.[0]?.text)
      .toBe("수정한 발췌");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "읽기 설정", exact: true }).click();
    await page.getByRole("combobox", { name: "글꼴", exact: true }).selectOption("@serif");
    await page.getByRole("spinbutton", { name: "문단 들여쓰기 (em)", exact: true }).fill("1.5");
    await page.keyboard.press("Tab");
    await page.keyboard.press("Escape");
    await page.reload();
    await expect(page.locator('[data-component="ReaderWorkspace"]')).toHaveCSS("--reader-indent", "1.5em");
    await expect(source.locator("[data-reader-prose]").first()).toHaveCSS("font-family", /Georgia/);
    expect(
      await source
        .locator("[data-reader-prose]")
        .first()
        .evaluate((node) => Number.parseFloat(getComputedStyle(node).textIndent)),
    ).toBeGreaterThan(0);
    await page.getByRole("button", { name: "저장한 발췌", exact: true }).click();
    await expect(page.getByText("수정한 발췌", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "삭제", exact: true }).click();
    await page
      .getByRole("dialog", { name: "삭제", exact: true })
      .getByRole("button", { name: "삭제", exact: true })
      .click();
    await expect
      .poll(async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata.readerExcerpts?.length)
      .toBe(0);
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
test("encoded formatted TTS hides wrappers and attaches controls beside each dialogue", async ({ page, request }) => {
  const chat = await (
    await request.post("/api/chats", { data: { name: "TTS 표시 검증", mode: "roleplay", characterIds: [] } })
  ).json();
  const content =
    "&lt;audio_character id=&quot;unknown&quot;&gt;**“[calm, flat] First dialogue.”**&lt;/audio_character&gt;\n\n“[happy] Second dialogue.”";
  const message = await (
    await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "assistant", content } })
  ).json();
  const config = await (await request.get("/api/tts/config")).json();
  await page.route("**/api/tts/config", (route) =>
    route.fulfill({ json: { ...config, enabled: true, dialogueOnly: true } }),
  );
  try {
    await open(page, chat.id);
    const owner = page.locator(`[data-message-id="${message.id}"]`);
    await expect(owner).not.toContainText("audio_character");
    await expect(owner).not.toContainText("[calm, flat]");
    await expect(owner).not.toContainText("[happy]");
    await expect(owner.locator("[data-tts-dialogue] [data-dialogue-controls]")).toHaveCount(2);
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
test("translation presets and glossary are reachable inside native chat translation settings", async ({
  page,
  request,
}) => {
  const snapshot = await (await request.get("/api/native-integrations/settings")).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "번역 진입 검증", mode: "conversation", characterIds: [] } })
  ).json();
  try {
    await open(page, chat.id);
    await page.getByRole("button", { name: "엔진 도구 보기", exact: true }).click();
    await page.locator("[data-chat-settings-button]").click();
    const section = page.locator('[data-chat-settings-section="translation"]');
    await section.locator("[data-drawer-toggle]").click();
    await page.locator('[data-component="TranslationIntegratedTools"] summary').click();
    await page.getByRole("button", { name: "프리셋 추가", exact: true }).click();
    await page.getByRole("textbox", { name: "프리셋 이름", exact: true }).fill("한국어 검증");
    await page.getByRole("button", { name: "단어 추가", exact: true }).click();
    await page.getByRole("textbox", { name: "원어", exact: true }).fill("Alice");
    await page.getByRole("textbox", { name: "번역어", exact: true }).fill("앨리스");
    // Built-in presets from the translation extension are selectable for incoming and outgoing translation.
    const tools = page.locator('[data-component="TranslationIntegratedTools"]');
    await tools.getByRole("combobox", { name: "번역 프리셋", exact: true }).selectOption({ label: "자연스러운 RP" });
    await tools
      .getByRole("combobox", { name: "입력 번역 프리셋", exact: true })
      .selectOption("builtin-literary-roleplay-input");
    await expect(tools.getByRole("combobox", { name: "번역 프리셋", exact: true }).locator("option")).toHaveCount(
      1 + 15 + 1,
    );
    await tools.getByRole("button", { name: "저장", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/native-integrations/settings")).json()).translation.rooms[chat.id]
            ?.glossary[0]?.target,
      )
      .toBe("앨리스");
    const saved = (await (await request.get("/api/native-integrations/settings")).json()).translation;
    expect(saved.rooms[chat.id].presetId).toBe("builtin-roleplay");
    expect(saved.rooms[chat.id].outgoingPresetId).toBe("builtin-literary-roleplay-input");
    const added = saved.presets.find((preset: { name: string }) => preset.name === "한국어 검증");
    expect(added.replace).toBe(true);
    expect(added.targetLanguage).toBeUndefined();
    await page.screenshot({ path: ".tmp/translation-builtin-presets.png" });
  } finally {
    const latest = await (await request.get("/api/native-integrations/settings")).json();
    await request.put("/api/native-integrations/settings", { data: { ...snapshot, revision: latest.revision } });
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
test("character customization saves display overrides separately and editor aligns with native header", async ({
  page,
  request,
}) => {
  const character = await (await request.post("/api/characters", { data: { data: { name: "원본 캐릭터" } } })).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "원본 작품", mode: "roleplay", characterIds: [character.id] } })
  ).json();
  try {
    await open(page, chat.id);
    await page.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
    await page.evaluate(async (id) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().openCharacterDetail(id);
    }, character.id);
    const custom = page.locator('[data-component="CharacterLibraryCustomization"]');
    await custom.locator("summary").click();
    await custom.getByRole("textbox", { name: "작품 제목", exact: true }).fill("긴 한국어 제목 日本語 English 작품");
    await custom.getByRole("textbox", { name: "표시 이름", exact: true }).fill("서재 별명");
    await custom.getByRole("textbox", { name: "작품 설명", exact: true }).fill("첫 줄 설명\n둘째 줄 설명");
    await custom.getByRole("button", { name: "표시 정보 저장", exact: true }).click();
    expect(JSON.parse((await (await request.get(`/api/characters/${character.id}`)).json()).data).name).toBe(
      "원본 캐릭터",
    );
    const shell = page.locator(".mari-editor-shell").first();
    const topbar = page.locator('[data-component="TopBar"]');
    const headerBox = await topbar.boundingBox();
    const editorBox = await shell.boundingBox();
    expect(Math.abs(editorBox!.y - (headerBox!.y + headerBox!.height))).toBeLessThan(3);
    await page.screenshot({ path: `.tmp/handoff-editor-${test.info().project.name}.png`, fullPage: true });
    await page.evaluate(async () => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().closeCharacterDetail();
    });
    const detail = page.locator('[data-component="LibraryWorkDetail"]');
    await expect(detail).toContainText("서재 별명");
    await expect(detail.getByRole("heading", { name: "긴 한국어 제목 日本語 English 작품" })).toBeVisible();
    await expect(detail).toContainText("둘째 줄 설명");
    await page.reload();
    await page.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
    await expect(detail).toContainText("서재 별명");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(async (id) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().openCharacterDetail(id);
    }, character.id);
    await custom.locator("summary").click();
    await custom.getByRole("textbox", { name: "작품 제목", exact: true }).fill("저장하지 않은 제목");
    await page.evaluate(async () => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().closeCharacterDetail();
    });
    await page
      .getByRole("dialog", { name: "취소", exact: true })
      .getByRole("button", { name: "계속 편집", exact: true })
      .click();
    await expect(custom.getByRole("textbox", { name: "작품 제목", exact: true })).toHaveValue("저장하지 않은 제목");
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/characters/${character.id}`);
  }
});
test("reading index retains order and opens the stored work in both themes", async ({ page, request }) => {
  const rooms: { id: string; name: string; messageId: string }[] = [];
  try {
    for (const [index, name] of ["첫 번째 기록", "두 번째 기록", "세 번째 기록"].entries()) {
      const chat = await (
        await request.post("/api/chats", { data: { name, mode: "roleplay", characterIds: [] } })
      ).json();
      const message = await (
        await request.post(`/api/chats/${chat.id}/messages`, {
          data: { role: "assistant", content: `기록 본문 ${index}` },
        })
      ).json();
      rooms.push({ ...chat, messageId: message.id });
    }
    await open(page, rooms[0]!.id);
    await page.evaluate(async (rows) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.setState({
        readerPositions: Object.fromEntries(
          rows.map((row, index) => [
            row.id,
            { messageId: row.messageId, messageNumber: 1, offset: 0, updatedAt: `2026-10-22T0${index + 1}:00:00.000Z` },
          ]),
        ),
      });
    }, rooms);
    await page.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
    await page.getByRole("button", { name: "서재로 돌아가기", exact: true }).click();
    await page
      .getByRole("navigation", { name: "서재 탐색" })
      .getByRole("button", { name: "기록", exact: true })
      .click();
    const index = page.getByRole("region", { name: "읽은 순서", exact: true });
    await expect(index.getByRole("button")).toHaveCount(3);
    await expect(index.getByRole("button").first()).toContainText("세 번째 기록");
    await expect(index.getByRole("button").first()).toContainText("01");
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate(async (theme) => {
        const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
        useUIStore.getState().setTheme(theme);
      }, theme);
      await page.screenshot({ path: `.tmp/handoff-index-${theme}-${test.info().project.name}.png`, fullPage: true });
    }
    await index.getByRole("button").first().click();
    await expect(page.getByRole("heading", { name: "세 번째 기록", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "이어 읽기", exact: true }).click();
    await expect(page.locator('[data-component="ReaderWorkspace"]')).toContainText("기록 본문 2");
  } finally {
    for (const room of rooms) await request.delete(`/api/chats/${room.id}?force=true`);
  }
});
