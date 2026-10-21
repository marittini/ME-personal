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
    await memory.getByText("Stored memories and evidence", { exact: true }).click();
    await expect(memory.getByText("No confirmed memories yet.", { exact: true })).toBeVisible();
    await memory.getByRole("checkbox", { name: "Use unified memory" }).uncheck();
    await expect(panel.locator("[data-chat-summary]")).toBeVisible();
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});
