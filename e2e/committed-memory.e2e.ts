import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState } from "./ui-state-fixture.js";
import { openChatSettingsTool } from "./chat-settings-tools.js";
const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
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
    await memory.getByRole("checkbox", { name: "Use unified memory" }).check();
    await expect(panel.locator("[data-chat-summary]")).toHaveCount(0);
    const bubble = page.locator("[data-memory-commit]");
    await expect(bubble).toBeVisible();
    await memory.getByRole("button", { name: "Settings", exact: true }).click();
    const floating = memory.getByRole("checkbox", { name: "Show one-click summary button" });
    await floating.uncheck();
    await expect(bubble).toHaveCount(0);
    await floating.check();
    await expect(bubble).toBeVisible();
    await expect(memory.getByText("Choose a text generation connection to summarize this chat.").last()).toBeVisible();
    await memory.getByRole("button", { name: "Story", exact: true }).click();
    await expect(memory.getByText("No confirmed memories yet.", { exact: true })).toBeVisible();
    await memory.getByRole("button", { name: "Overview", exact: true }).click();
    await memory.getByRole("checkbox", { name: "Use unified memory" }).uncheck();
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
    await vault.getByRole("button", { name: "Promises", exact: true }).click();
    await vault.getByRole("button", { name: "In progress", exact: true }).click();
    await expect(vault.locator(".memory-vault__row")).toHaveCount(1);
    await expect(vault.locator(".memory-vault__row")).toContainText("진행 중 여행 약속");
    await testInfo.attach("memory-vault-progress", { body: await vault.screenshot(), contentType: "image/png" });
    await vault.locator(".memory-vault__row").click();
    await expect(vault.locator(".memory-vault__prose").first()).toHaveText("앨리스가 여행을 준비하고 있다.");
    await vault.getByLabel("Promise progress", { exact: true }).selectOption("completed");
    await vault.getByRole("button", { name: "Completed", exact: true }).click();
    await expect(vault.locator(".memory-vault__row")).toHaveCount(2);
    const status = await (await request.get(`/api/chats/${id}/committed-memory`)).json();
    const updated = status.state.batches
      .flatMap((batch: { facts: Array<{ id: string; content: string; progress: string }> }) => batch.facts)
      .find((fact: { id: string }) => fact.id === "active-trip");
    expect(updated.content).toBe("Alice is arranging a trip.");
    expect(updated.progress).toBe("completed");
    await vault.getByRole("button", { name: "Settings", exact: true }).click();
    await vault.getByRole("checkbox", { name: "Show Korean memory text" }).uncheck();
    await vault.getByRole("button", { name: "Promises", exact: true }).click();
    await expect(vault.locator(".memory-vault__row").filter({ hasText: "active trip" })).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});
