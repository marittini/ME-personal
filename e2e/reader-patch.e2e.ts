import { expect, test } from "@playwright/test";
import { seedUIState, isolateSyncedUISettings } from "./ui-state-fixture";
import { readFileSync } from "node:fs";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
async function quiet(page: import("@playwright/test").Page, chatId?: string) {
  await isolateSyncedUISettings(page);
  await seedUIState(
    page,
    {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      language: "ko",
      chatHelpSeenModes: ["roleplay", "conversation"],
      appAccentColor: "#ff00ff",
      appAccentRgbMode: true,
      appAccentPulseMode: true,
    },
    "if-missing",
  );
  await page.addInitScript(
    ({ version, chatId }) => {
      localStorage.setItem("marinara:whats-new:seen-version", version);
      if (chatId) localStorage.setItem("marinara-active-chat-id", chatId);
    },
    { version, chatId },
  );
}
for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: Korean spacing persistence, theme isolation and cached speech`, async ({ page, request }) => {
    const chat = await (
      await request.post("/api/chats", { data: { name: `읽기 검증 ${mode}`, mode, characterIds: [] } })
    ).json();
    try {
      const content = '"[whispering] First line." 잠시 쉬었다. "[sniff] Second line."';
      await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "user", content: "[happy] 사용자 원문" } });
      const message = await (
        await request.post(`/api/chats/${chat.id}/messages`, { data: { role: "assistant", content } })
      ).json();
      const config = await (await request.get("/api/tts/config")).json();
      await page.route("**/api/tts/config", (route) =>
        route.fulfill({
          json: { ...config, source: "openai", voice: "alloy", enabled: true, dialogueOnly: true, dialoguePauseMs: 0 },
        }),
      );
      const calls: string[] = [];
      const pcm = Buffer.alloc(44 + 16000 * 2 * 10);
      pcm.write("RIFF");
      pcm.writeUInt32LE(pcm.length - 8, 4);
      pcm.write("WAVEfmt ", 8);
      pcm.writeUInt32LE(16, 16);
      pcm.writeUInt16LE(1, 20);
      pcm.writeUInt16LE(1, 22);
      pcm.writeUInt32LE(16000, 24);
      pcm.writeUInt32LE(32000, 28);
      pcm.writeUInt16LE(2, 32);
      pcm.writeUInt16LE(16, 34);
      pcm.write("data", 36);
      pcm.writeUInt32LE(pcm.length - 44, 40);
      await page.route("**/api/tts/speak", async (route) => {
        calls.push(route.request().postDataJSON().text);
        await route.fulfill({ body: pcm, contentType: "audio/wav" });
      });
      await quiet(page, chat.id);
      await page.goto("/");
      const workspace = page.locator('[data-component="ReaderWorkspace"]');
      await expect(workspace).toHaveAttribute("data-reader-enabled", "true");
      await expect(page.locator("html")).toHaveAttribute("lang", "ko");
      await expect(workspace).toContainText("[happy] 사용자 원문");
      await expect(
        workspace.locator(".mari-message-content").filter({ hasText: "First line" }).first(),
      ).not.toContainText("[whispering]");
      await expect(
        workspace.locator(".mari-message-content").filter({ hasText: "Second line" }).first(),
      ).not.toContainText("[sniff]");
      expect(
        await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim()),
      ).not.toBe("#ff00ff");
      const speech = workspace.locator(`[data-message-id="${message.id}"]`);
      if (mode === "conversation") {
        // Phones open the message actions with a tap on the message, desktops on hover.
        const revealActions = async () => {
          if (!test.info().project.name.startsWith("mobile"))
            return speech.locator(".mari-message-content").first().hover();
          if (!(await speech.locator(".mari-message-actions.opacity-100").count()))
            await speech.locator(".mari-message-content").first().click();
          await expect(speech.locator(".mari-message-actions.opacity-100")).toHaveCount(1);
        };
        // Conversation speaks the whole message from its actions, like the TTS extension; no per-line buttons.
        await expect(speech.locator("[data-dialogue-controls]")).toHaveCount(0);
        await revealActions();
        await speech.getByRole("button", { name: "음성 생성", exact: true }).click();
        await expect.poll(() => calls.join(" ")).toContain("Second line.");
        expect(calls.join(" ")).toContain("First line.");
        const generated = calls.length;
        const replay = speech.locator("[data-conversation-speech-replay]");
        await expect(replay).toHaveAttribute("aria-label", "음성 멈춤");
        await replay.click();
        await expect(replay).toHaveAttribute("aria-label", "다시 듣기");
        await replay.click();
        await expect(replay).toHaveAttribute("aria-label", "음성 멈춤");
        await replay.click();
        expect(calls.length).toBe(generated);
        await revealActions();
        await speech.getByRole("button", { name: "음성 다시 생성", exact: true }).click();
        await page.getByRole("button", { name: "취소", exact: true }).click();
        expect(calls.length).toBe(generated);
        await revealActions();
        await speech.getByRole("button", { name: "음성 다시 생성", exact: true }).click();
        await page.getByRole("dialog").getByRole("button", { name: "음성 다시 생성", exact: true }).click();
        await expect.poll(() => calls.length).toBe(generated * 2);
        await page.screenshot({ path: `.tmp/${mode}-message-speech.png` });
      } else {
        await expect(speech.locator("[data-dialogue-controls]")).toHaveCount(2);
        // Each control must sit inside its own spoken line, never in a row under the message.
        await expect(speech.locator("[data-tts-dialogue] [data-dialogue-controls]")).toHaveCount(2);
        // Lines are quiet until tapped: a tap opens that line's popover, a press elsewhere closes it.
        const lines = speech.locator("[data-tts-dialogue-tappable]");
        const popover = speech.locator("[data-dialogue-popover]");
        await expect(popover).toHaveCount(0);
        const openLine = async (index: number) => {
          if (!(await popover.filter({ visible: true }).count())) await lines.nth(index).click();
          await expect(speech.locator(`[data-dialogue-popover="${index}"]`)).toBeVisible();
        };
        await openLine(0);
        await speech.getByRole("button", { name: "1번 대사 음성 생성", exact: true }).click();
        await expect.poll(() => calls.length).toBe(1);
        expect(calls[0]).toContain("First line.");
        expect(calls[0]).not.toContain("Second line.");
        await speech.getByRole("button", { name: "1번 대사 멈춤", exact: true }).click();
        await speech.getByRole("button", { name: "1번 대사 재생", exact: true }).click();
        await expect(speech.getByRole("button", { name: "1번 대사 멈춤", exact: true })).toBeVisible();
        expect(calls.length).toBe(1);
        await speech.getByRole("button", { name: "1번 대사 멈춤", exact: true }).click();
        await speech.getByRole("button", { name: "1번 대사 음성 재생성", exact: true }).click();
        await page.getByRole("button", { name: "취소", exact: true }).click();
        expect(calls.length).toBe(1);
        await openLine(0);
        await speech.getByRole("button", { name: "1번 대사 음성 재생성", exact: true }).click();
        await page.getByRole("button", { name: "음성 재생성", exact: true }).click();
        await expect.poll(() => calls.length).toBe(2);
        await speech.getByRole("button", { name: "1번 대사 멈춤", exact: true }).click();
        // A press outside closes the popover.
        await page.mouse.click(5, 5);
        await expect(popover).toHaveCount(0);
        await openLine(1);
        await speech.getByRole("button", { name: "2번 대사 음성 생성", exact: true }).click();
        await expect.poll(() => calls.length).toBe(3);
        expect(calls[2]).toContain("Second line.");
        await speech.getByRole("button", { name: "2번 대사 멈춤", exact: true }).click();
      }
      const stored = await (await request.get(`/api/chats/${chat.id}/messages`)).json();
      expect(JSON.stringify(stored)).toContain("[whispering]");
      expect(JSON.stringify(stored)).toContain(message.id);
      await workspace.getByRole("button", { name: "읽기 설정", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "읽기 설정", exact: true });
      await dialog.getByRole("spinbutton", { name: "자간 (px)", exact: true }).fill("0.7");
      await dialog.getByRole("button", { name: "행간 0.1 늘리기", exact: true }).click();
      await page.screenshot({ path: `.tmp/${mode}-reading-settings.png` });
      await page.keyboard.press("Escape");
      await expect(workspace.locator(".mari-message-content").first()).toHaveCSS("letter-spacing", "0.7px");
      await page.reload();
      // A dev-server reload can take over 20 s in a slow sandbox before the transcript renders.
      await expect(workspace.locator(".mari-message-content").first()).toBeVisible({ timeout: 60_000 });
      await expect(workspace.locator(".mari-message-content").first()).toHaveCSS("letter-spacing", "0.7px");
      await expect(workspace).toHaveCSS("--reader-line-height", "1.9");
      await workspace.getByRole("button", { name: "읽기 설정", exact: true }).click();
      // The 크림 page is the light theme (the former "화면 테마: 밝게").
      await page
        .getByRole("dialog", { name: "읽기 설정", exact: true })
        .getByRole("radio", { name: "크림", exact: true })
        .click();
      await page.keyboard.press("Escape");
      await expect(page.locator("html")).toHaveCSS("background-color", "rgb(251, 248, 243)");
      expect(
        await page.locator("html").evaluate((el) => getComputedStyle(el).getPropertyValue("--primary").trim()),
      ).toBe("#936b4b");
      await page.screenshot({ path: `.tmp/${mode}-reading-light.png` });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
    }
  });
}
for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: tagged character/persona lines hide wrappers and cues and keep controls beside each line`, async ({
    page,
    request,
  }) => {
    const card = await (await request.post("/api/characters", { data: { data: { name: "IV" } } })).json();
    const persona = await (await request.post("/api/characters/personas", { data: { name: "세코" } })).json();
    const chat = await (
      await request.post("/api/chats", {
        data: { name: `태그 검증 ${mode}`, mode, characterIds: [card.id], personaId: persona.id },
      })
    ).json();
    try {
      await request.patch(`/api/chats/${chat.id}/metadata`, { data: { ttsTaggedDialogue: true } });
      const content = [
        "세코는 열쇠를 바라보았다.",
        `<audio_persona id="${persona.id}">"[calm, flat] ……마음대로 해."</audio_persona>`,
        "IV는 손목을 놓았다.",
        `<audio_character id="${card.id}">"[flustered, gruff] ……간다."</audio_character>`,
      ].join("\n\n");
      const message = await (
        await request.post(`/api/chats/${chat.id}/messages`, {
          data: { role: "assistant", content, characterId: card.id },
        })
      ).json();
      const config = await (await request.get("/api/tts/config")).json();
      await page.route("**/api/tts/config", (route) =>
        route.fulfill({
          json: {
            ...config,
            source: "openai",
            voice: "alloy",
            enabled: true,
            voiceAssignments: [{ characterId: card.id, characterName: "IV", voice: "char-voice" }],
            personaVoiceAssignments: [{ personaId: persona.id, personaName: "세코", voice: "persona-voice" }],
          },
        }),
      );
      await quiet(page, chat.id);
      await page.goto("/");
      const speech = page.locator(`[data-component="ReaderWorkspace"] [data-message-id="${message.id}"]`);
      await expect(speech).toContainText("마음대로 해.");
      await expect(speech).toContainText("간다.");
      for (const hidden of ["audio_persona", "audio_character", "[calm, flat]", "[flustered, gruff]", persona.id])
        await expect(speech).not.toContainText(hidden);
      if (mode === "conversation") {
        await expect(speech.locator("[data-dialogue-controls]")).toHaveCount(0);
        // Phones reveal message tools on a tap, desktops on hover.
        if (test.info().project.name.startsWith("mobile"))
          await speech.locator(".mari-message-content").first().click();
        else await speech.locator(".mari-message-content").first().hover();
        await expect(speech.getByRole("button", { name: "음성 생성", exact: true })).toBeVisible();
      } else {
        await expect(speech.locator("[data-tts-dialogue] [data-dialogue-controls]")).toHaveCount(2);
        await expect(speech.locator("[data-tts-dialogue]").first()).toContainText("마음대로 해.");
      }
      await page.screenshot({ path: `.tmp/${mode}-tagged-dialogue.png` });
      const stored = await (await request.get(`/api/chats/${chat.id}/messages`)).json();
      expect(JSON.stringify(stored)).toContain("[calm, flat]");
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
      await request.delete(`/api/characters/personas/${persona.id}`);
      await request.delete(`/api/characters/${card.id}`);
    }
  });
}
for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: translation-only view hides audio tags and keeps speech controls beside translated lines`, async ({
    page,
    request,
  }) => {
    const card = await (await request.post("/api/characters", { data: { data: { name: "IV" } } })).json();
    const persona = await (await request.post("/api/characters/personas", { data: { name: "세코" } })).json();
    const chat = await (
      await request.post("/api/chats", {
        data: { name: `번역 태그 검증 ${mode}`, mode, characterIds: [card.id], personaId: persona.id },
      })
    ).json();
    try {
      await request.patch(`/api/chats/${chat.id}/metadata`, {
        data: { ttsTaggedDialogue: true, translationDisplayOnly: true },
      });
      const content = [
        "Seko looked at the key.",
        `<audio_persona id="${persona.id}">"[calm, flat] ……Do as you like."</audio_persona>`,
        "IV let go of her wrist.",
        `<audio_character id="${card.id}">"[flustered, gruff] ……I'm leaving."</audio_character>`,
      ].join("\n\n");
      // A translation saved before tags were stripped from translation input still carries them.
      const translation = [
        "세코는 열쇠를 바라보았다.",
        `<audio_persona id="${persona.id}">"[calm, flat] ……마음대로 해."</audio_persona>`,
        "IV는 손목을 놓았다.",
        `<audio_character id="${card.id}">"[flustered, gruff] ……간다."</audio_character>`,
      ].join("\n\n");
      const message = await (
        await request.post(`/api/chats/${chat.id}/messages`, {
          data: { role: "assistant", content, characterId: card.id },
        })
      ).json();
      await request.patch(`/api/chats/${chat.id}/messages/${message.id}/extra`, {
        data: { translation, translationSource: content, translationHidden: false },
      });
      const config = await (await request.get("/api/tts/config")).json();
      await page.route("**/api/tts/config", (route) =>
        route.fulfill({
          json: {
            ...config,
            source: "openai",
            voice: "alloy",
            enabled: true,
            voiceAssignments: [{ characterId: card.id, characterName: "IV", voice: "char-voice" }],
            personaVoiceAssignments: [{ personaId: persona.id, personaName: "세코", voice: "persona-voice" }],
          },
        }),
      );
      await quiet(page, chat.id);
      await page.goto("/");
      const speech = page.locator(`[data-component="ReaderWorkspace"] [data-message-id="${message.id}"]`);
      await expect(speech).toContainText("마음대로 해.");
      for (const hidden of ["audio_persona", "audio_character", "[calm, flat]", persona.id, "Do as you like"])
        await expect(speech).not.toContainText(hidden);
      await expect(speech.locator("[data-tts-dialogue] [data-dialogue-controls]")).toHaveCount(
        mode === "conversation" ? 0 : 2,
      );
      await page.screenshot({ path: `.tmp/${mode}-translation-only-tags.png` });
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
      await request.delete(`/api/characters/personas/${persona.id}`);
      await request.delete(`/api/characters/${card.id}`);
    }
  });
}
test("conversation: the voice button stays visible without a voice and asks for one only when no default voice exists", async ({
  page,
  request,
}) => {
  const card = await (await request.post("/api/characters", { data: { data: { name: "목소리 없음" } } })).json();
  const chat = await (
    await request.post("/api/chats", { data: { name: "보이스 없음", mode: "conversation", characterIds: [card.id] } })
  ).json();
  try {
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", characterId: card.id, content: "보이스 없는 답장" },
      })
    ).json();
    const config = await (await request.get("/api/tts/config")).json();
    let voice = "";
    let enabled = false;
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        json: { ...config, source: "openai", voice, voiceMode: "per-character", voiceAssignments: [], enabled },
      }),
    );
    const calls: unknown[] = [];
    await page.route("**/api/tts/speak", async (route) => {
      calls.push(route.request().postDataJSON());
      await route.fulfill({ status: 500, body: "" });
    });
    await quiet(page, chat.id);
    await page.goto("/");
    const row = page.locator(`[data-message-id="${message.id}"]`);
    const reveal = async () => {
      if (!test.info().project.name.startsWith("mobile")) return row.locator(".mari-message-content").first().hover();
      if (!(await row.locator(".mari-message-actions.opacity-100").count()))
        await row.locator(".mari-message-content").first().click();
    };
    // Visible with voice reading off too (as in the TTS extension); pressing it says what to turn on.
    await reveal();
    await row.getByRole("button", { name: "음성 생성", exact: true }).click();
    await expect(page.getByText("음성 읽기가 꺼져 있어요. 읽기 설정의 음성에서 켜세요.")).toBeVisible();
    enabled = true;
    await page.reload();
    await reveal();
    await row.getByRole("button", { name: "음성 생성", exact: true }).click();
    await expect(page.getByText("음성 설정에서 이 화자의 보이스를 먼저 고르세요.")).toBeVisible();
    expect(calls).toHaveLength(0);
    // With a default voice, a character without its own voice speaks with the default voice.
    voice = "alloy";
    await page.reload();
    await reveal();
    await row.getByRole("button", { name: "음성 생성", exact: true }).click();
    await expect.poll(() => calls.length).toBeGreaterThan(0);
    expect((calls[0] as { voice: string }).voice).toBe("alloy");
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/characters/${card.id}`);
  }
});
test("settings tab opens a function hub; voice settings live in Connections", async ({ page }) => {
  await quiet(page);
  await page.goto("/");
  await page.getByRole("navigation", { name: "서재 탐색" }).getByRole("button", { name: "설정", exact: true }).click();
  await expect(page.getByRole("heading", { name: "마이페이지", exact: true })).toBeVisible();
  // My page no longer lists Speech & calls; the same card opens from the Connections panel.
  await expect(page.getByRole("button", { name: "음성·통화 설정", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "모델·이미지 연결", exact: true }).click();
  const voice = page.locator('[data-component="TTSConfigCard"]:visible');
  await expect(voice).toBeVisible();
  await expect(voice.getByRole("checkbox", { name: "TTS 활성화", exact: true })).toBeVisible();
  await page.screenshot({ path: ".tmp/settings-hub-voice.png" });
});

test("message illustration sends its exact ID range and preserves the composer draft", async ({ page, request }) => {
  const chat = await (
    await request.post("/api/chats", { data: { name: "삽화 연결 검증", mode: "roleplay", characterIds: [] } })
  ).json();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requests: Record<string, unknown>[] = [];
  try {
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", content: "삽화로 남길 장면입니다." },
      })
    ).json();
    await page.route("**/api/generate/retry-agents", async (route) => {
      requests.push(route.request().postDataJSON());
      await gate;
      await route.fulfill({ contentType: "text/event-stream", body: "event: done\ndata: {}\n\n" });
    });
    await quiet(page, chat.id);
    await page.goto("/");
    const workspace = page.locator('[data-component="ReaderWorkspace"]');
    const composer = workspace.locator("textarea").last();
    await composer.fill("작성 중인 초안은 그대로");
    const action = workspace.getByRole("button", { name: "이 메시지로 삽화 생성", exact: true });
    await workspace.locator(".mari-message-content").filter({ hasText: "삽화로 남길 장면입니다." }).first().click();
    const target = await action.boundingBox();
    expect(target?.width).toBeGreaterThanOrEqual(44);
    expect(target?.height).toBeGreaterThanOrEqual(44);
    await action.click();
    await expect.poll(() => requests.length).toBe(1);
    expect(requests[0]!.illustratorMessageRange).toEqual([message.id, message.id]);
    await expect(action).toBeDisabled();
    await expect(composer).toHaveValue("작성 중인 초안은 그대로");
    release();
    await expect(action).toBeEnabled();
  } finally {
    release?.();
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});

test("NAI character prompt uses two raw requests, exposes copyable outputs and preserves the card", async ({
  page,
  request,
}) => {
  const card = await (
    await request.post("/api/characters", {
      data: {
        data: {
          name: "외형 분석 검증",
          description: "A woman with blue eyes.",
          extensions: { appearance: "long black hair" },
        },
      },
    })
  ).json();
  try {
    await quiet(page);
    await page.route("**/api/connections", (route) =>
      route.fulfill({
        json: [{ id: "prompt-proof", provider: "openai", name: "검증 모델", isDefault: true, model: "fixture" }],
      }),
    );
    const shape = {
      subject: [{ value: "girl", evidence: "woman" }],
      bodyTypeMajor: [],
      appearance: {
        hair: [{ value: "long black hair", evidence: "long black hair" }],
        eyes: [{ value: "blue eyes", evidence: "blue eyes" }],
        skin: [],
        bodyTypeMinor: [],
      },
      attire: [],
      composition: [],
      action: [],
      expression: [],
      negative: [],
      text: { location: [], font: [], attributes: [], content: [] },
    };
    const calls: Array<{ messages: Array<{ content: string }> }> = [];
    await page.route("**/api/generate/raw", (route) => {
      calls.push(route.request().postDataJSON());
      return route.fulfill({ json: { content: JSON.stringify(shape) } });
    });
    await page.goto("/");
    await page
      .getByRole("navigation", { name: "서재 탐색" })
      .getByRole("button", { name: "설정", exact: true })
      .click();
    await page.getByRole("button", { name: "NovelAI 캐릭터 프롬프트", exact: true }).click();
    await page.getByRole("combobox", { name: "캐릭터·페르소나", exact: true }).selectOption(`character:${card.id}`);
    await page.getByRole("button", { name: "프롬프트 생성", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "긍정 프롬프트", exact: true })).toHaveValue(
      "girl, long black hair, blue eyes",
    );
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]!.messages[1]!.content).source).toEqual({
      description: "A woman with blue eyes.",
      appearance: "long black hair",
    });
    const after = await (await request.get(`/api/characters/${card.id}`)).json();
    expect(after.data).toEqual(card.data);
    await page.screenshot({ path: ".tmp/nai-character-prompt.png" });
  } finally {
    await request.delete(`/api/characters/${card.id}`);
  }
});

test("bundled Korean can be selected without a language-pack download", async ({ page }) => {
  await quiet(page);
  let downloads = 0;
  await page.route("**/api/ui-languages/ko", (route) => {
    if (route.request().method() === "POST") downloads++;
    return route.fulfill({ status: 503, json: { error: "No downloadable pack in this proof" } });
  });
  await page.goto("/");
  await page.getByRole("navigation", { name: "서재 탐색" }).getByRole("button", { name: "설정", exact: true }).click();
  await page.getByRole("button", { name: "언어·일반 설정", exact: true }).click();
  const select = page.locator("#settings-control-language-select");
  await select.selectOption("en");
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await select.selectOption("ko");
  await expect(page.locator("html")).toHaveAttribute("lang", "ko");
  expect(downloads).toBe(0);
});

test("roleplay translation-only: controls stay beside tagged lines when the translated narration quotes words too", async ({
  page,
  request,
}) => {
  // Device report 2026-10-24: Japanese narration quoting 『…』 came back translated with "…", which the reader
  // also marks as dialogue, so the count no longer matched the tagged lines and every button fell to the bottom.
  const card = await (await request.post("/api/characters", { data: { data: { name: "IV" } } })).json();
  const persona = await (await request.post("/api/characters/personas", { data: { name: "세코" } })).json();
  const chat = await (
    await request.post("/api/chats", {
      data: { name: "번역 인용 검증", mode: "roleplay", characterIds: [card.id], personaId: persona.id },
    })
  ).json();
  try {
    await request.patch(`/api/chats/${chat.id}/metadata`, {
      data: { ttsTaggedDialogue: true, translationDisplayOnly: true },
    });
    const content = [
      "額が 離れる。",
      `<audio_character id="${card.id}">"[low, gruff] ……腹 減った。"</audio_character>`,
      "さっきまで 人の 部屋を 勝手に 検閲して『麦茶と 卵しか ねぇ』と 文句を 言って いた。",
      `<audio_persona id="${persona.id}">"[calm, flat] ……だから 卵しか ないと 言った だろうが。"</audio_persona>`,
      "世古も「いつまで いるんだ」とは 聞かない。",
      `<audio_character id="${card.id}">"[irritated, low] また ゼリーかよ。"</audio_character>`,
    ].join("\n\n");
    const translation = [
      "이마가 떨어진다.",
      `"……배고파."`,
      `아까까지 남의 방을 멋대로 검열하며 "보리차랑 달걀밖에 없네"라고 불평하던 사람이다.`,
      `"……그러니까 달걀밖에 없다고 했잖아."`,
      `세코도 "언제까지 있을 거냐"고는 묻지 않는다.`,
      `"또 젤리냐."`,
    ].join("\n\n");
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", content, characterId: card.id },
      })
    ).json();
    await request.patch(`/api/chats/${chat.id}/messages/${message.id}/extra`, {
      data: { translation, translationSource: content, translationHidden: false },
    });
    const config = await (await request.get("/api/tts/config")).json();
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        json: {
          ...config,
          source: "openai",
          voice: "alloy",
          enabled: true,
          voiceAssignments: [{ characterId: card.id, characterName: "IV", voice: "char-voice" }],
          personaVoiceAssignments: [{ personaId: persona.id, personaName: "세코", voice: "persona-voice" }],
        },
      }),
    );
    await quiet(page, chat.id);
    await page.goto("/");
    const speech = page.locator(`[data-component="ReaderWorkspace"] [data-message-id="${message.id}"]`);
    await expect(speech).toContainText("배고파");
    const controls = speech.locator("[data-tts-dialogue] [data-dialogue-controls]");
    await expect(controls).toHaveCount(3);
    for (const [index, line] of ["배고파", "달걀밖에 없다고 했잖아", "또 젤리냐"].entries())
      await expect(controls.nth(index).locator("xpath=ancestor::*[@data-tts-dialogue][1]")).toContainText(line);
    await page.screenshot({ path: ".tmp/translation-only-narration-quotes.png" });
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/characters/personas/${persona.id}`);
    await request.delete(`/api/characters/${card.id}`);
  }
});

test("roleplay original view: controls stay beside tagged lines when the narration quotes words in 『』 and 「」", async ({
  page,
  request,
}) => {
  // Device report 2026-10-24: Japanese narration quoting 『…』 came back translated with "…", which the reader
  // also marks as dialogue, so the count no longer matched the tagged lines and every button fell to the bottom.
  const card = await (await request.post("/api/characters", { data: { data: { name: "IV" } } })).json();
  const persona = await (await request.post("/api/characters/personas", { data: { name: "세코" } })).json();
  const chat = await (
    await request.post("/api/chats", {
      data: { name: "원문 인용 검증", mode: "roleplay", characterIds: [card.id], personaId: persona.id },
    })
  ).json();
  try {
    await request.patch(`/api/chats/${chat.id}/metadata`, {
      data: { ttsTaggedDialogue: true },
    });
    const content = [
      "額が 離れる。",
      `<audio_character id="${card.id}">"[low, gruff] ……腹 減った。"</audio_character>`,
      "さっきまで 人の 部屋を 勝手に 検閲して『麦茶と 卵しか ねぇ』と 文句を 言って いた。",
      `<audio_persona id="${persona.id}">"[calm, flat] ……だから 卵しか ないと 言った だろうが。"</audio_persona>`,
      "世古も「いつまで いるんだ」とは 聞かない。",
      `<audio_character id="${card.id}">"[irritated, low] また ゼリーかよ。"</audio_character>`,
    ].join("\n\n");
    const message = await (
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", content, characterId: card.id },
      })
    ).json();
    const config = await (await request.get("/api/tts/config")).json();
    await page.route("**/api/tts/config", (route) =>
      route.fulfill({
        json: {
          ...config,
          source: "openai",
          voice: "alloy",
          enabled: true,
          voiceAssignments: [{ characterId: card.id, characterName: "IV", voice: "char-voice" }],
          personaVoiceAssignments: [{ personaId: persona.id, personaName: "세코", voice: "persona-voice" }],
        },
      }),
    );
    await quiet(page, chat.id);
    await page.goto("/");
    const speech = page.locator(`[data-component="ReaderWorkspace"] [data-message-id="${message.id}"]`);
    await expect(speech).toContainText("腹 減った");
    const controls = speech.locator("[data-tts-dialogue] [data-dialogue-controls]");
    await expect(controls).toHaveCount(3);
    for (const [index, line] of ["腹 減った", "卵しか ないと", "また ゼリーかよ"].entries())
      await expect(controls.nth(index).locator("xpath=ancestor::*[@data-tts-dialogue][1]")).toContainText(line);
    // Per-line buttons are small, so they sit inside the line instead of pushing it apart.
    // Nothing sits in the line until it is tapped; then a small popover holds the buttons, above the line.
    await expect(controls.first().locator("button")).toHaveCount(0);
    const line = speech.locator("[data-tts-dialogue-tappable]").first();
    await line.click();
    const popover = speech.locator('[data-dialogue-popover="0"]');
    await expect(popover).toBeVisible();
    const button = (await popover.locator("button").first().boundingBox())!;
    expect(button.height).toBeLessThan(30);
    expect(button.width).toBeLessThan(30);
    const [lineBox, popoverBox] = [(await line.boundingBox())!, (await popover.boundingBox())!];
    expect(popoverBox.y + popoverBox.height <= lineBox.y + 2 || popoverBox.y >= lineBox.y + lineBox.height - 2).toBe(
      true,
    );
    await page.screenshot({ path: ".tmp/original-narration-quotes.png" });
  } finally {
    await request.delete(`/api/chats/${chat.id}?force=true`);
    await request.delete(`/api/characters/personas/${persona.id}`);
    await request.delete(`/api/characters/${card.id}`);
  }
});
