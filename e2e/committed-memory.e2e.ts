import { expect, test, type Locator } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState } from "./ui-state-fixture.js";
import { openChatSettingsTool } from "./chat-settings-tools.js";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
/** Turns a settings switch on or off through its visible switch. */
async function setSwitch(toggle: Locator, checked: boolean) {
  // The input is visually hidden inside its switch label; press the switch like a person does.
  if ((await toggle.isChecked()) !== checked) await toggle.locator("xpath=ancestor::label[1]").click();
  await expect(toggle).toBeChecked({ checked });
}
test("unified memory preserves the legacy summary view until enabled", async ({ page, request }) => {
  const created = await request.post("/api/chats", { data: { name: "Committed memory UI", mode: "roleplay" } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  try {
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    await page.addInitScript(
      ({ id, version }) => {
        localStorage.setItem("marinara-active-chat-id", id);
        localStorage.setItem("marinara:whats-new:seen-version", version);
      },
      { id, version },
    );
    await page.goto("/");
    const panel = await openChatSettingsTool(page, "chat-summary");
    const memory = panel.locator("[data-committed-memory]");
    await expect(memory).toBeVisible();
    await expect(memory.getByRole("button", { name: "Commit memory", exact: true })).toBeDisabled();
    await setSwitch(memory.getByRole("checkbox", { name: "Use unified memory" }), true);
    await expect(panel.locator("[data-chat-summary]")).toHaveCount(0);
    const bubble = page.locator("[data-memory-commit]");
    await expect(bubble).toBeVisible();
    await memory.getByRole("button", { name: "Settings", exact: true }).click();
    const batchSize = memory.getByRole("spinbutton", { name: /^Messages per summary/ });
    await batchSize.fill("7");
    await batchSize.press("Tab");
    await expect
      .poll(async () => {
        const saved = await (await request.get(`/api/chats/${id}`)).json();
        return saved.metadata.committedMemoryBatchSize;
      })
      .toBe(7);
    await memory.getByText("Advanced summary and connection settings", { exact: true }).click();
    const floating = memory.getByRole("checkbox", { name: "Show one-click summary button" });
    await setSwitch(floating, false);
    await expect(bubble).toHaveCount(0);
    await setSwitch(floating, true);
    await expect(bubble).toBeVisible();
    await expect(memory.getByText("Choose a text generation connection to summarize this chat.").last()).toBeVisible();
    await memory.getByRole("button", { name: "Flow", exact: true }).click();
    await expect(memory.getByText("No confirmed memories yet.", { exact: true })).toBeVisible();
    await memory.getByRole("button", { name: "Overview", exact: true }).click();
    await setSwitch(memory.getByRole("checkbox", { name: "Use unified memory" }), false);
    await expect(panel.locator("[data-chat-summary]")).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("vault shows first-response Korean text and filters promise lifecycle without changing originals", async ({
  page,
  request,
}, testInfo) => {
  const { memoryFingerprint } = await import("../packages/server/src/services/committed-memory-policy.js");
  const created = await request.post("/api/chats", { data: { name: "Bilingual vault", mode: "roleplay" } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  try {
    const messageResponse = await request.post(`/api/chats/${id}/messages`, {
      data: { role: "assistant", content: "Alice promises to return a book." },
    });
    expect(messageResponse.ok()).toBeTruthy();
    const message = await messageResponse.json();
    const memory = {
      version: 1,
      ownerChatId: id,
      enabled: true,
      batches: [
        {
          id: "ui-episode",
          turn: 1,
          createdAt: new Date().toISOString(),
          sources: [{ id: message.id, fingerprint: memoryFingerprint(message) }],
          summary: "Alice makes three promises.",
          summaryKo: "앨리스가 세 가지 약속을 했다.",
          core: "Three promises remain on record.",
          coreKo: "세 가지 약속이 기록되었다.",
          facts: [
            {
              id: "pending-book",
              kind: "promise",
              key: "pending book",
              keyKo: "미완료 책 약속",
              content: "Alice will return a book.",
              contentKo: "앨리스가 책을 돌려주기로 했다.",
              status: "current",
              progress: "pending",
              audience: "shared",
              sourceIds: [message.id],
            },
            {
              id: "active-trip",
              kind: "promise",
              key: "active trip",
              keyKo: "진행 중 여행 약속",
              content: "Alice is arranging a trip.",
              contentKo: "앨리스가 여행을 준비하고 있다.",
              status: "current",
              progress: "in_progress",
              audience: "shared",
              sourceIds: [message.id],
            },
            {
              id: "done-task",
              kind: "promise",
              key: "done task",
              keyKo: "완료한 작업 약속",
              content: "Alice finished her task.",
              contentKo: "앨리스가 작업을 끝냈다.",
              status: "resolved",
              progress: "completed",
              audience: "shared",
              sourceIds: [message.id],
            },
          ],
        },
      ],
    };
    expect((await request.patch(`/api/chats/${id}/metadata`, { data: { committedMemory: memory } })).ok()).toBeTruthy();
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    await page.addInitScript(
      ({ id, version }) => {
        localStorage.setItem("marinara-active-chat-id", id);
        localStorage.setItem("marinara:whats-new:seen-version", version);
      },
      { id, version },
    );
    await page.goto("/");
    const drawer = await openChatSettingsTool(page, "chat-summary");
    const vault = drawer.locator("[data-committed-memory]");
    await vault.getByRole("button", { name: "Threads & promises", exact: true }).click();
    await vault.getByRole("button", { name: "In progress", exact: true }).click();
    await expect(vault.locator(".memory-vault__row")).toHaveCount(1);
    await expect(vault.locator(".memory-vault__row")).toContainText("진행 중 여행 약속");
    await testInfo.attach("memory-vault-progress", { body: await vault.screenshot(), contentType: "image/png" });
    await vault.locator(".memory-vault__row").click();
    await expect(vault.locator(".memory-vault__prose").first()).toHaveText("앨리스가 여행을 준비하고 있다.");
    const evidence = vault.locator("details.memory-vault__evidence");
    await expect(evidence).not.toHaveAttribute("open", "");
    await expect(evidence.locator(".memory-vault__source")).not.toBeVisible();
    await evidence.locator(":scope > summary").click();
    await expect(evidence.locator(".memory-vault__source")).toBeVisible();
    await expect(evidence.locator(".memory-vault__source summary")).not.toContainText(message.id.slice(0, 8));
    await vault.getByRole("combobox", { name: "Promise progress", exact: true }).selectOption("completed");
    await vault.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(vault.locator(".memory-vault__row")).toHaveCount(2);
    const status = await (await request.get(`/api/chats/${id}/committed-memory`)).json();
    const updated = status.state.batches
      .flatMap((batch: { facts: Array<{ id: string; content: string; progress: string }> }) => batch.facts)
      .find((fact: { id: string }) => fact.id === "active-trip");
    expect(updated.content).toBe("Alice is arranging a trip.");
    expect(updated.progress).toBe("completed");
    await vault.getByRole("button", { name: "Settings", exact: true }).click();
    await setSwitch(vault.getByRole("checkbox", { name: "Show Korean memory text" }), false);
    await vault.getByRole("button", { name: "Threads & promises", exact: true }).click();
    await expect(vault.locator(".memory-vault__row").filter({ hasText: "active trip" })).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("format 2: overview counts and undoable tidy-up, namesake review, call-up controls and who knows", async ({
  page,
  request,
}) => {
  const { memoryFingerprint } = await import("../packages/server/src/services/committed-memory-policy.js");
  const character = await (await request.post("/api/characters", { data: { data: { name: "Knower Kim" } } })).json();
  const created = await request.post("/api/chats", {
    data: { name: "Entity vault", mode: "roleplay", characterIds: [character.id] },
  });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  try {
    const message = await (
      await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content: "Mira takes the ring." } })
    ).json();
    const at = new Date().toISOString();
    const memory = {
      version: 2,
      ownerChatId: id,
      enabled: true,
      entities: [
        { id: "mira-1", name: "Mira", aliases: [], kind: "person", createdAt: at },
        { id: "mira-2", name: "Mira", aliases: [], kind: "person", createdAt: at },
        { id: "ring", name: "Silver ring", aliases: ["반지"], kind: "object", createdAt: at },
      ],
      batches: [
        {
          id: "episode-1",
          turn: 1,
          createdAt: at,
          sources: [{ id: message.id, fingerprint: memoryFingerprint(message) }],
          summary: "Mira takes the ring.",
          core: "Mira has the ring.",
          facts: [
            {
              id: "ring-owner",
              kind: "fact",
              key: "ring owner",
              content: "Mira owns the silver ring.",
              status: "current",
              audience: [character.id],
              sourceIds: [message.id],
              entityId: "ring",
              attribute: "owner",
              previous: [
                {
                  id: "ring-owner",
                  kind: "fact",
                  key: "ring owner",
                  content: "Nobody owns the silver ring.",
                  status: "current",
                  audience: "shared",
                  sourceIds: [message.id],
                  entityId: "ring",
                  attribute: "owner",
                  dependencies: [{ id: message.id, fingerprint: memoryFingerprint(message) }],
                  turn: 0,
                },
              ],
            },
          ],
        },
      ],
    };
    expect((await request.patch(`/api/chats/${id}/metadata`, { data: { committedMemory: memory } })).ok()).toBeTruthy();
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    await page.addInitScript(
      ({ id, version }) => {
        localStorage.setItem("marinara-active-chat-id", id);
        localStorage.setItem("marinara:whats-new:seen-version", version);
      },
      { id, version },
    );
    await page.goto("/");
    const drawer = await openChatSettingsTool(page, "chat-summary");
    const vault = drawer.locator("[data-committed-memory]");
    const counts = vault.locator("[data-memory-counts]");
    const count = (label: string) => counts.locator("div").filter({ hasText: label }).locator("dd");
    await expect(count("Entities")).toHaveText("3");
    await expect(count("Namesakes to check")).toHaveText("0");
    await expect(vault.getByText("While unified memory is on in Roleplay", { exact: false }).first()).toBeVisible();
    // Tidy-up only marks the namesakes and can be undone.
    await vault.getByRole("button", { name: "Tidy up memory (merge)", exact: true }).click();
    await expect(count("Namesakes to check")).toHaveText("2");
    const history = vault.locator("[data-memory-history] li");
    await expect(history).toHaveCount(1);
    await expect(history).toContainText("Tidy-up");
    await history.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(history).toHaveCount(0);
    await expect(count("Namesakes to check")).toHaveText("0");
    await vault.getByRole("button", { name: "Tidy up memory (merge)", exact: true }).click();
    await vault.screenshot({ path: `.tmp/memory-overview-${test.info().project.name}.png` });
    await vault.getByRole("button", { name: "Review namesakes", exact: true }).click();
    const entities = vault.locator("[data-memory-entities]");
    await expect(entities.locator("[data-homonym]")).toHaveCount(2);
    await entities.locator("[data-homonym]").first().getByRole("button", { name: "Someone else", exact: true }).click();
    await expect(entities.locator("[data-homonym]")).toHaveCount(0);
    let status = await (await request.get(`/api/chats/${id}/committed-memory`)).json();
    expect(status.state.entities.map((e: { id: string }) => e.id).sort()).toEqual(["mira-1", "mira-2", "ring"]);
    // One entity's facts, who knows them, earlier values, and the call-up controls.
    await entities.getByRole("button", { name: /Silver ring/ }).click();
    await expect(vault.locator(".memory-vault__row")).toHaveCount(1);
    await vault.locator(".memory-vault__row").click();
    await expect(vault.locator("[data-memory-knowledge]")).toHaveText("Known by Knower Kim");
    await expect(vault.locator("[data-memory-previous] summary")).toHaveText("Earlier values (1)");
    const recall = vault.locator("[data-memory-recall]");
    await vault.screenshot({ path: `.tmp/memory-entity-${test.info().project.name}.png` });
    await expect(recall.getByRole("radio", { name: "When called up" })).toHaveAttribute("aria-checked", "true");
    await recall.getByRole("radio", { name: "Always" }).click();
    await expect(recall.getByRole("radio", { name: "Always" })).toHaveAttribute("aria-checked", "true");
    await recall.getByLabel(/Keywords/).fill("ring, 반지");
    await recall.getByLabel(/Combinations/).fill("ring + lost");
    await recall.getByRole("button", { name: "Save call-up words", exact: true }).click();
    await expect(recall.getByRole("button", { name: "Save call-up words", exact: true })).toBeDisabled();
    status = await (await request.get(`/api/chats/${id}/committed-memory`)).json();
    const fact = status.state.batches[0].facts.find((f: { id: string }) => f.id === "ring-owner");
    expect(fact).toMatchObject({ activation: "always", keywords: ["ring", "반지"], combos: [["ring", "lost"]] });
    const evidence = vault.locator("details.memory-vault__evidence");
    await evidence.locator(":scope > summary").click();
    await evidence.locator(".memory-vault__source summary").click();
    await expect(evidence.getByRole("button", { name: "Go to this message", exact: true })).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
    await request.delete(`/api/characters/${character.id}`);
  }
});

test("format 3: scenes with exact lines, threads, state history, waiting batch and re-commit offer", async ({
  page,
  request,
}, testInfo) => {
  const { memoryFingerprint } = await import("../packages/server/src/services/committed-memory-policy.js");
  const created = await request.post("/api/chats", { data: { name: "Scene ledger", mode: "roleplay" } });
  expect(created.ok()).toBeTruthy();
  const { id } = await created.json();
  try {
    const post = async (content: string) => {
      const response = await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content } });
      expect(response.ok()).toBeTruthy();
      return response.json();
    };
    const old = await post("Mira was human at the inn.");
    const scene = await post('Mira turns into a borzoi. Ren whispers, "You were human a moment ago."');
    // Three messages wait; batches are five, so nothing can be committed yet.
    for (const content of ["They walk.", "They rest.", "They eat."]) await post(content);
    const createdAt = new Date().toISOString();
    const memory = {
      version: 3,
      ownerChatId: id,
      enabled: true,
      entities: [{ id: "mira", name: "Mira", aliases: ["미라"], kind: "person", createdAt }],
      batches: [
        {
          id: "old-batch",
          turn: 1,
          createdAt,
          sources: [{ id: old.id, fingerprint: memoryFingerprint(old) }],
          summary: "Mira is human at the inn.",
          core: "Mira is human.",
          summaryKo: "미라는 여관에서 인간이었다.",
          coreKo: "미라는 인간이다.",
          facts: [],
        },
        {
          id: "scene-batch",
          turn: 2,
          createdAt,
          sources: [{ id: scene.id, fingerprint: memoryFingerprint(scene) }],
          summary: "Mira becomes a borzoi in front of Ren.",
          core: "Mira is a borzoi.",
          summaryKo: "미라가 렌 앞에서 보르조이가 되었다.",
          coreKo: "미라는 보르조이다.",
          facts: [
            {
              id: "mira-form",
              kind: "state",
              key: "Mira form",
              keyKo: "미라 형태",
              content: "Mira is a borzoi.",
              contentKo: "미라는 보르조이다.",
              status: "current",
              audience: "shared",
              sourceIds: [scene.id],
              entityId: "mira",
              attribute: "form",
              previous: [
                {
                  id: "mira-form",
                  kind: "state",
                  key: "Mira form",
                  content: "Mira is human.",
                  contentKo: "미라는 인간이다.",
                  status: "current",
                  audience: "shared",
                  sourceIds: [old.id],
                  entityId: "mira",
                  attribute: "form",
                  dependencies: [{ id: old.id, fingerprint: memoryFingerprint(old) }],
                  turn: 1,
                },
              ],
            },
            {
              id: "howl",
              kind: "thread",
              key: "night howl",
              keyKo: "밤의 울음",
              content: "Something howls at night.",
              contentKo: "밤마다 무언가 운다.",
              endCondition: "the source of the howl is found",
              endConditionKo: "울음의 정체가 밝혀진다",
              status: "current",
              audience: "shared",
              sourceIds: [scene.id],
            },
          ],
          scenes: [
            {
              id: "borzoi-scene",
              when: "night",
              where: "forest",
              participants: ["Mira", "Ren"],
              event: "Mira turns into a borzoi in front of Ren.",
              eventKo: "미라가 렌 앞에서 보르조이로 변한다.",
              lines: [{ speaker: "Ren", to: "Mira", text: "You were human a moment ago.", sourceId: scene.id }],
              changes: ["Mira: human → borzoi"],
              changesKo: ["미라: 인간 → 보르조이"],
              audience: "shared",
              sourceIds: [scene.id],
            },
          ],
        },
      ],
    };
    expect(
      (
        await request.patch(`/api/chats/${id}/metadata`, {
          data: { committedMemory: memory, committedMemoryBatchSize: 5 },
        })
      ).ok(),
    ).toBeTruthy();
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    await page.addInitScript(
      ({ id, version }) => {
        localStorage.setItem("marinara-active-chat-id", id);
        localStorage.setItem("marinara:whats-new:seen-version", version);
      },
      { id, version },
    );
    await page.goto("/");
    await expect(page.locator("[data-memory-commit] [data-memory-suggest]")).toHaveCount(0);
    await expect(page.locator("[data-memory-commit]")).toContainText("3/5");
    const drawer = await openChatSettingsTool(page, "chat-summary");
    const vault = drawer.locator("[data-committed-memory]");
    await expect(vault.locator("[data-memory-pending]")).toHaveText("Waiting 3/5");
    await expect(vault.locator("[data-memory-partial]")).toBeVisible();
    await expect(vault.getByRole("button", { name: "Commit memory", exact: true })).toBeDisabled();
    // The batch without scenes is offered a re-commit.
    await expect(vault.locator("[data-memory-legacy]")).toContainText("1");
    await expect(
      vault.locator("[data-memory-legacy]").getByRole("button", { name: "Re-commit in the new format" }),
    ).toBeVisible();

    await vault.getByRole("button", { name: "Scenes", exact: true }).click();
    await expect(vault.locator("[data-memory-scene]")).toHaveCount(1);
    await vault.locator("[data-memory-scene]").click();
    const detail = vault.locator("[data-memory-scene-detail]");
    await expect(detail).toContainText("미라가 렌 앞에서 보르조이로 변한다.");
    await expect(detail.locator(".memory-vault__quote")).toContainText("Ren → Mira");
    await expect(detail.locator(".memory-vault__quote")).toContainText("“You were human a moment ago.”");
    await expect(detail).toContainText("미라: 인간 → 보르조이");
    await testInfo.attach("memory-scene", { body: await vault.screenshot(), contentType: "image/png" });

    await vault.getByRole("button", { name: "Threads & promises", exact: true }).click();
    const thread = vault.locator(".memory-vault__row").filter({ hasText: "밤의 울음" });
    await expect(thread).toContainText("Open thread");
    await thread.click();
    await expect(vault.locator("[data-memory-end-condition]")).toHaveText("Closes when: 울음의 정체가 밝혀진다");

    await vault.getByRole("button", { name: "Entities", exact: true }).click();
    const state = vault.locator(".memory-vault__row").filter({ hasText: "미라 형태" });
    await expect(state).toContainText("State");
    await state.click();
    await expect(vault.locator("[data-memory-previous]")).toContainText("Earlier values (1)");

    // A full batch turns the badge into a commit suggestion.
    for (const content of ["They talk.", "They sleep."]) await post(content);
    await page.reload();
    await expect(page.locator("[data-memory-commit] [data-memory-suggest]")).toHaveText("5");
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});
