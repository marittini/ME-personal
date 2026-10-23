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
    // Extension features: colored highlighter on a selection, alignment, texture, replacement rule.
    const studioText = page.getByRole("textbox", { name: "발췌할 글", exact: true });
    // Select the first three characters the way a keyboard user would (React reads the textarea selection).
    await studioText.focus();
    await page.keyboard.press("Control+Home");
    for (let i = 0; i < 3; i++) await page.keyboard.press("Shift+ArrowRight");
    await page.getByRole("button", { name: "형광펜 (분홍)", exact: true }).click();
    await page.getByRole("group", { name: "정렬", exact: true }).getByRole("button", { name: "가운데" }).click();
    await page.getByRole("group", { name: "질감", exact: true }).getByRole("button", { name: "다크" }).click();
    await page.getByRole("button", { name: "+ 치환 규칙 추가", exact: true }).click();
    await page.getByRole("textbox", { name: "1번 찾기", exact: true }).fill("저장");
    await page.getByRole("textbox", { name: "1번 바꿀 글", exact: true }).fill("보관");
    await expect(page.getByRole("button", { name: "PNG로 저장", exact: true })).toBeEnabled();
    // The preview stays in view while the lower controls are used.
    await page.getByRole("spinbutton", { name: "둥글기", exact: true }).scrollIntoViewIfNeeded();
    await expect(
      page
        .getByRole("img", { name: "발췌 이미지 미리보기" })
        .or(page.locator('canvas[aria-label="발췌 이미지 미리보기"]')),
    ).toBeInViewport();
    await page.screenshot({ path: ".tmp/excerpt-studio.png" });
    const [download] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name: "PNG로 저장", exact: true }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^발췌_\d{8}_\d{6}\.png$/);
    await page.getByRole("button", { name: "발췌 저장", exact: true }).click();
    await expect
      .poll(async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata.readerExcerpts?.length)
      .toBe(1);
    const stored = (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata.readerExcerpts[0];
    expect(stored.marks).toEqual([{ start: 0, end: 3, type: "highlight", color: "p" }]);
    expect(stored.appearance.align).toBe("center");
    expect(stored.appearance.background).toMatchObject({ mode: "texture", texture: "dark" });
    expect(stored.appearance.textColor).toBe("#EFE8DA");
    expect(stored.appearance.replaceRules).toEqual([{ find: "저장", replace: "보관" }]);
    await page.keyboard.press("Escape");
    await page.reload();
    await expect.poll(() => page.evaluate(() => CSS.highlights.get("reader-excerpts")?.size ?? 0)).toBe(1);
    await page.getByRole("button", { name: "독서 노트", exact: true }).click();
    await page.getByRole("tab", { name: /발췌 카드/ }).click();
    await page.getByRole("button", { name: "편집", exact: true }).click();
    // Reopening restores the excerpt's own look, not the default one.
    await expect(
      page.getByRole("group", { name: "정렬", exact: true }).getByRole("button", { name: "가운데" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("textbox", { name: "1번 바꿀 글", exact: true })).toHaveValue("보관");
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
    await page.getByRole("button", { name: "독서 노트", exact: true }).click();
    await page.getByRole("tab", { name: /발췌 카드/ }).click();
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
async function selectText(page: Page, messageId: string, text: string) {
  await expect(page.locator(`[data-message-id="${messageId}"] .mari-message-content`).first()).toContainText(text);
  await page.evaluate(
    ({ messageId, text }) => {
      const message = document.querySelector(`[data-message-id="${CSS.escape(messageId)}"]`)!;
      const walker = document.createTreeWalker(message, NodeFilter.SHOW_TEXT);
      let node: Node | null;
      while ((node = walker.nextNode())) {
        const at = node.textContent!.indexOf(text);
        if (at < 0 || !node.parentElement?.closest(".mari-message-content")) continue;
        const range = document.createRange();
        range.setStart(node, at);
        range.setEnd(node, at + text.length);
        const selection = window.getSelection()!;
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new Event("selectionchange"));
        return;
      }
      throw new Error(`text not found: ${text}`);
    },
    { messageId, text },
  );
}
test("reading notes: colored highlights, private memos and excerpt cards from notes", async ({ page, request }) => {
  // An unreachable fixture connection lets the dry run build the real prompt without calling a model.
  const connection = await (
    await request.post("/api/connections", {
      data: {
        name: "Reading notes privacy",
        provider: "custom",
        baseUrl: "http://127.0.0.1:1/v1",
        apiKey: "fixture",
        model: "notes-fixture",
        maxContext: 32768,
      },
    })
  ).json();
  const chat = await (
    await request.post("/api/chats", {
      data: { name: "독서 노트 검증", mode: "roleplay", characterIds: [], connectionId: connection.id },
    })
  ).json();
  try {
    const content = "첫 문장은 분홍으로 칠합니다. 둘째 문장에는 메모를 남깁니다.\n\nThe last paragraph stays plain.";
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "assistant", content } })
    ).json();
    const metadata = async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata;
    const painted = (name: string) => page.evaluate((name) => CSS.highlights.get(name)?.size ?? 0, name);
    await open(page, chat.id);
    const workspace = page.locator('[data-component="ReaderWorkspace"]');
    const toolbar = workspace.getByRole("toolbar", { name: "선택한 글", exact: true });

    await selectText(page, message.id, "첫 문장은 분홍으로 칠합니다.");
    await toolbar.getByRole("button", { name: "분홍 형광펜", exact: true }).click();
    await expect.poll(async () => (await metadata()).readerHighlights?.[0]?.color).toBe("p");
    await expect.poll(() => painted("reader-note-p")).toBe(1);
    // Highlighting the same sentence again changes its color instead of stacking a copy.
    await selectText(page, message.id, "첫 문장은 분홍으로 칠합니다.");
    await toolbar.getByRole("button", { name: "파랑 형광펜", exact: true }).click();
    await expect
      .poll(async () => (await metadata()).readerHighlights?.map((row: { color: string }) => row.color))
      .toEqual(["b"]);

    await selectText(page, message.id, "둘째 문장에는 메모를 남깁니다.");
    await toolbar.getByRole("button", { name: "메모", exact: true }).click();
    const editor = page.getByRole("dialog", { name: "형광펜 · 메모", exact: true });
    await editor.getByRole("textbox", { name: "메모", exact: true }).fill("나만 보는 비밀 메모");
    await editor.getByRole("button", { name: "초록", exact: true }).click();
    await editor.getByRole("button", { name: "저장", exact: true }).click();
    await expect(editor).toBeHidden();
    await expect
      .poll(async () => (await metadata()).readerHighlights?.find((row: { note: string }) => row.note)?.note)
      .toBe("나만 보는 비밀 메모");
    await expect.poll(() => painted("reader-note-memo")).toBe(1);

    // Memos are display-only: the prompt the AI would receive never contains them.
    const dryRun = await request.post("/api/generate/dryRun", { data: { chatId: chat.id, returnPrompt: true } });
    expect(dryRun.ok(), await dryRun.text()).toBeTruthy();
    const prompt = JSON.stringify((await dryRun.json()).prompt.messages);
    expect(prompt).toContain("The last paragraph stays plain.");
    expect(prompt).not.toContain("나만 보는 비밀 메모");

    await page.reload();
    // A reload recompiles the roleplay surface in a cold dev server; allow it the time a page open gets.
    await expect.poll(() => painted("reader-note-b"), { timeout: 30_000 }).toBe(1);
    await expect.poll(() => painted("reader-note-g")).toBe(1);
    // Tapping the memo sentence opens it again, like a novel reader.
    const point = await page.evaluate(() => {
      const range = [...CSS.highlights.get("reader-note-memo")!][0] as Range;
      const rect = range.getClientRects()[0]!;
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    await page.mouse.click(point.x, point.y);
    await expect(editor.getByRole("textbox", { name: "메모", exact: true })).toHaveValue("나만 보는 비밀 메모");
    await page.screenshot({ path: ".tmp/reading-note-editor.png" });
    // The excerpt card carries only the sentence, not the memo.
    await editor.getByRole("button", { name: "발췌 카드로 만들기", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "발췌할 글", exact: true })).toHaveValue(
      "둘째 문장에는 메모를 남깁니다.",
    );
    await page.keyboard.press("Escape");

    // The reader bar keeps only back, title, notes, focus and settings (owner request 2026-10-23).
    await expect(workspace.locator("header button")).toHaveCount(4);
    await workspace.getByRole("button", { name: "독서 노트", exact: true }).click();
    const notes = page.getByRole("dialog", { name: "독서 노트", exact: true });
    await expect(notes.getByText("나만 보는 비밀 메모", { exact: true })).toBeVisible();
    await expect(notes.getByRole("tab")).toHaveText([/형광펜/, /발췌 카드/, /메시지 북마크/]);
    await page.screenshot({ path: ".tmp/reading-notes.png" });
    await notes.getByRole("button", { name: "메모 편집", exact: true }).click();
    await editor.getByRole("button", { name: "형광펜 삭제", exact: true }).click();
    await page
      .getByRole("dialog", { name: "형광펜 삭제", exact: true })
      .getByRole("button", { name: "형광펜 삭제", exact: true })
      .click();
    await expect.poll(async () => (await metadata()).readerHighlights?.length).toBe(1);
    expect(JSON.stringify(await metadata())).not.toContain("나만 보는 비밀 메모");
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/connections/${connection.id}`);
  }
});
test("paragraph translation editor uses the reader's paragraph boundaries and saves aligned rows", async ({
  page,
  request,
}) => {
  const chat = await (
    await request.post("/api/chats", { data: { name: "문단 경계 검증", mode: "roleplay", characterIds: [] } })
  ).json();
  try {
    const content = "첫 문단입니다.\n\n```js\na()\n\nb()\n```\n\n- 하나\n\n- 둘\n\n마지막 문단.";
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "assistant", content } })
    ).json();
    await open(page, chat.id);
    // The editor sits after the message body (one message in this room).
    const workspace = page.locator('[data-component="ReaderWorkspace"]');
    await expect(workspace.locator(`[data-message-id="${message.id}"]`)).toContainText("마지막 문단.");
    await workspace.locator("summary", { hasText: "번역 대조·편집" }).click();
    const rows = workspace.getByRole("textbox", { name: /번 문단 번역$/ });
    await expect(rows).toHaveCount(4);
    const values = ["First paragraph.", "```js\na()\n\nb()\n```", "- one\n\n- two", "Last paragraph."];
    for (const [index, value] of values.entries()) await rows.nth(index).fill(value);
    await workspace.getByRole("button", { name: "문단 번역 저장", exact: true }).click();
    await expect
      .poll(async () => {
        const stored = await (await request.get(`/api/chats/${chat.id}/messages`)).json();
        const extra = stored.find((row: { id: string }) => row.id === message.id)?.extra;
        return (typeof extra === "string" ? JSON.parse(extra) : extra)?.translation;
      })
      .toBe(values.join("\n\n"));
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});
test("translation presets write into the native prompt fields and the panel saves its glossary", async ({
  page,
  request,
}) => {
  const snapshot = await (await request.get("/api/native-integrations/settings")).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "번역 진입 검증", mode: "conversation", characterIds: [] } })
  ).json();
  await request.patch(`/api/chats/${chat.id}/metadata`, { data: { translationProvider: "ai" } });
  const metadata = async () => (await (await request.get(`/api/chats/${chat.id}`)).json()).metadata;
  const room = async () =>
    (await (await request.get("/api/native-integrations/settings")).json()).translation.rooms[chat.id];
  try {
    await open(page, chat.id);
    await page.locator("[data-chat-settings-button]").click();
    const section = page.locator('[data-chat-settings-section="translation"]');
    await section.locator("[data-drawer-toggle]").click();
    // The panel sits inside the native section, as the extension placed it (no separate form to open).
    const panel = section.locator('[data-component="TranslationPresetPanel"]');
    await expect(panel.getByRole("heading", { name: "번역 프롬프트", exact: true })).toBeVisible();
    const incoming = panel.getByRole("combobox", { name: "캐릭터 응답 번역 프롬프트 프리셋", exact: true });
    await expect(incoming.locator("option")).toHaveCount(16);
    await incoming.selectOption({ label: "자연스러운 RP" });
    await expect(panel.getByRole("status")).toHaveText("캐릭터 응답 번역 프롬프트에 적용했습니다.");
    // The chosen prompt is what the native field shows and what the chat stores.
    const nativeIncoming = section.locator("textarea").nth(1);
    await expect(nativeIncoming).toHaveValue(/^You are an expert literary and roleplay translator/);
    await expect
      .poll(async () => (await metadata()).translationOutputPrompt)
      .toMatch(/^You are an expert literary and roleplay translator/);
    await expect.poll(async () => (await room())?.presetId).toBe("builtin-roleplay");
    expect((await room()).presetsInNative).toBe(true);
    // "채팅 설정 유지" restores the prompt the field had before the preset.
    await incoming.selectOption({ label: "채팅 설정 유지" });
    await expect.poll(async () => (await metadata()).translationOutputPrompt ?? null).toBeNull();
    await expect.poll(async () => (await room())?.presetId).toBeNull();

    await panel.getByRole("button", { name: "+ 단어 추가", exact: true }).click();
    await panel.getByRole("textbox", { name: "원문 단어", exact: true }).fill("Alice");
    await panel.getByRole("textbox", { name: "번역 단어", exact: true }).fill("앨리스");
    await panel.getByRole("button", { name: "새 프리셋", exact: true }).click();
    await panel.getByRole("textbox", { name: "프리셋 이름", exact: true }).fill("한국어 검증");
    await panel.getByRole("button", { name: "저장", exact: true }).click();
    await expect.poll(async () => (await room())?.glossary[0]?.target).toBe("앨리스");
    const saved = (await (await request.get("/api/native-integrations/settings")).json()).translation;
    expect(saved.presets.find((preset: { name: string }) => preset.name === "한국어 검증")?.replace).toBe(true);
    await expect(incoming.locator("option", { hasText: "사용자 정의 · 한국어 검증" })).toHaveCount(1);
    await panel.scrollIntoViewIfNeeded();
    await page.screenshot({ path: ".tmp/translation-panel.png", fullPage: false });
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
test("persona library labels are edited in the persona editor and shown on persona cards", async ({
  page,
  request,
}) => {
  const persona = await (await request.post("/api/characters/personas", { data: { name: "원본 페르소나" } })).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "페르소나 표시 검증", mode: "roleplay", characterIds: [] } })
  ).json();
  try {
    await open(page, chat.id);
    await page.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
    await page.evaluate(async (id) => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().openPersonaDetail(id);
    }, persona.id);
    const custom = page.locator('[data-component="PersonaLibraryCustomization"]');
    await custom.locator("summary").click();
    await custom.getByRole("textbox", { name: "부제", exact: true }).fill("현대 AU 버전");
    await custom.getByRole("textbox", { name: "표시 이름", exact: true }).fill("서재 페르소나 별명");
    await custom.getByRole("textbox", { name: "작품 설명", exact: true }).fill("페르소나 설명\n둘째 줄");
    await custom.getByRole("button", { name: "표시 정보 저장", exact: true }).click();
    // The persona itself (name used in prompts) is unchanged.
    const stored = await (await request.get(`/api/characters/personas/${persona.id}`)).json();
    expect(stored.name).toBe("원본 페르소나");
    await page.evaluate(async () => {
      const { useUIStore } = (await import("/src/stores/ui.store.ts" as string)) as PageUiStoreModule;
      useUIStore.getState().closePersonaDetail();
      useUIStore.getState().openPersonaLibrary();
    });
    const library = page.locator('[data-component="CharacterLibraryView"]');
    await expect(library.getByText("서재 페르소나 별명").first()).toBeVisible();
    await expect(library.getByText("원본 페르소나", { exact: true })).toHaveCount(0);
    await page.screenshot({ path: `.tmp/persona-library-${test.info().project.name}.png` });
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/characters/personas/${persona.id}`);
  }
});
test("global preset: preset-less rooms follow it and a new room is asked after setup", async ({ page, request }) => {
  const snapshot = await (await request.get("/api/native-integrations/settings")).json();
  const preset = await (await request.post("/api/prompts", { data: { name: "글로벌 검증 v1" } })).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "새 방 글로벌 검증", mode: "roleplay", characterIds: [] } })
  ).json();
  try {
    await request.put("/api/native-integrations/settings", {
      data: {
        ...snapshot,
        globalPreset: { ...snapshot.globalPreset, enabled: true, presetId: preset.id, presetName: preset.name },
      },
    });
    await open(page, chat.id);
    await page.evaluate(async () => {
      const { useChatStore } = (await import("/src/stores/chat.store.ts" as string)) as PageChatStoreModule;
      useChatStore.getState().setShouldOpenWizard(true);
      useChatStore.getState().setShouldOpenSettings(true);
    });
    await page.locator('[data-component="ChatSetupWizard"]').waitFor();
    await page.getByRole("button", { name: "건너뛰기", exact: true }).click();
    const ask = page.getByRole("dialog", { name: "새 방에 글로벌 프리셋을 적용할까요?", exact: true });
    await expect(ask).toContainText("글로벌 검증 v1");
    await page.screenshot({ path: `.tmp/global-preset-new-room-${test.info().project.name}.png` });
    await ask.getByRole("button", { name: "글로벌 적용", exact: true }).click();
    await expect
      .poll(
        async () =>
          (await (await request.get("/api/native-integrations/settings")).json()).globalPreset.rooms[chat.id]?.mode,
      )
      .toBe("follow");
  } finally {
    const latest = await (await request.get("/api/native-integrations/settings")).json();
    await request.put("/api/native-integrations/settings", { data: { ...snapshot, revision: latest.revision } });
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/prompts/${preset.id}`);
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
