import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState } from "./ui-state-fixture.js";
import { chatSettingsWindow, openChatSettings } from "./chat-settings-tools.js";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

test("settings sections fold to their titles, open from a header or a search, and stay as left", async ({ page }) => {
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "settings",
    settingsTab: "general",
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await page.goto("/");
  const sections = page.locator(".mari-settings-panel-chrome [data-settings-section]");
  await expect(sections.first()).toBeVisible();
  // Every section starts folded: only its title line shows.
  expect(
    await sections.evaluateAll((nodes) =>
      nodes.every((node) => node.getAttribute("data-settings-section") === "closed"),
    ),
  ).toBe(true);
  const first = sections.first();
  const toggle = first.locator(".mari-settings-section-toggle");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(first.locator("[id] > *").first()).toBeVisible();
  const openId = await first.getAttribute("id");
  await page.reload();
  await expect(page.locator(`#${openId}`)).toHaveAttribute("data-settings-section", "open");
  // A search result inside a folded section opens it.
  await page.getByPlaceholder("Search settings").fill("notification position");
  await page
    .locator(".mari-settings-search-header button")
    .filter({ hasText: "Notification position" })
    .first()
    .click();
  const assets = page.locator("#settings-section-notifications");
  await expect(assets).toHaveAttribute("data-settings-section", "open");
  await expect(assets.getByRole("combobox").first()).toBeVisible();
  await page.screenshot({ path: `.tmp/settings-groups-${test.info().project.name}.png` });
});

test("library lists read like a label: heavy bars around the list, hairlines between rows", async ({
  page,
  request,
}) => {
  const created = await Promise.all(
    ["Label Alpha", "Label Beta", "Label Gamma"].map(async (name) =>
      (await request.post("/api/characters", { data: { data: { name } } })).json(),
    ),
  );
  try {
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: "characters",
    });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    const row = page.locator("[data-receipt-row]").filter({ hasText: "Label Beta" });
    await expect(row).toBeVisible();
    const list = row.locator("xpath=..");
    const styles = await list.evaluate((node) => {
      const style = getComputedStyle(node);
      return { top: parseFloat(style.borderTopWidth), bottom: parseFloat(style.borderBottomWidth), gap: style.rowGap };
    });
    expect(styles.top).toBeGreaterThanOrEqual(6);
    expect(styles.bottom).toBeGreaterThanOrEqual(2);
    expect(styles.gap === "0px" || styles.gap === "normal").toBe(true);
    const second = page.locator("[data-receipt-row]").nth(1);
    expect(parseFloat(await second.evaluate((node) => getComputedStyle(node).borderTopWidth))).toBe(1);
    // The token value sits at the right edge of the row's text.
    const value = row.locator("[data-receipt-value]");
    const name = row.locator("[data-character-row-name]");
    const [valueBox, nameBox] = [await value.boundingBox(), await name.boundingBox()];
    expect(valueBox!.x).toBeGreaterThan(nameBox!.x + nameBox!.width - 1);
    await page.screenshot({ path: `.tmp/receipt-characters-${test.info().project.name}.png` });
  } finally {
    for (const character of created) await request.delete(`/api/characters/${character.id}`);
  }
});

test("Chat Settings tabs, the UI manager's placements and message tools behind more", async ({ page, request }) => {
  const created = await request.post("/api/chats", { data: { name: "UI manager", mode: "roleplay" } });
  const { id } = await created.json();
  try {
    await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content: "A reply with tools." } });
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
    const settings = await openChatSettings(page);
    const tabs = settings.locator("[data-chat-settings-tabs]");
    await expect(tabs.getByRole("tab")).toHaveText(["Chat", "Context", "Memory", "Other"]);
    const lorebooks = settings.locator('[data-chat-settings-section="lorebooks"]');
    const connection = settings.locator('[data-chat-settings-section="connection"]');
    await expect(connection).toBeVisible();
    await expect(lorebooks).toBeHidden();
    await tabs.getByRole("tab", { name: "Context" }).click();
    await expect(lorebooks).toBeVisible();
    await expect(connection).toBeHidden();
    await tabs.getByRole("tab", { name: "Memory" }).click();
    await expect(settings.locator('[data-chat-settings-section="roleplay-chat-summary"]')).toBeVisible();

    await settings.locator("[data-chat-ui-manager-button]").click();
    const manager = page.locator("[data-chat-ui-manager]");
    await expect(manager).toBeVisible();
    const lorebookRow = manager.locator('[data-ui-manager-item="lorebooks"]');
    await lorebookRow.getByRole("radio", { name: "Hidden" }).click();
    await expect(lorebookRow.getByRole("radio", { name: "Hidden" })).toHaveAttribute("aria-checked", "true");
    await page.keyboard.press("Escape");
    await tabs.getByRole("tab", { name: "Context" }).click();
    await expect(lorebooks).toBeHidden();
    // Back into Chat Settings.
    await settings.locator("[data-chat-ui-manager-button]").click();
    await manager.locator('[data-ui-manager-item="lorebooks"]').getByRole("radio", { name: "Settings" }).click();
    await page.keyboard.press("Escape");
    await expect(lorebooks).toBeVisible();

    // Top: the drawer leaves Chat Settings for a bubble at the top; Settings brings it back.
    await settings.locator("[data-chat-ui-manager-button]").click();
    await manager.locator('[data-ui-manager-item="connection"]').getByRole("radio", { name: "Top" }).click();
    const bubble = page.locator('.mari-window-bubble[data-window="drawer:chat-settings:connection"]');
    if (!test.info().project.name.startsWith("mobile")) await expect(bubble).toBeVisible();
    await manager.getByRole("tab", { name: "Top" }).click();
    await manager.locator('[data-ui-manager-item="connection"]').getByRole("radio", { name: "Settings" }).click();
    await expect(bubble).toHaveCount(0);
    await page.keyboard.press("Escape");
    await tabs.getByRole("tab", { name: "Chat" }).click();
    await expect(connection).toBeVisible();

    // Message tools: Copy waits behind the more button.
    await settings.locator("[data-chat-ui-manager-button]").click();
    await manager.getByRole("tab", { name: "Message tools" }).click();
    const copy = manager.locator('[data-ui-manager-tool="icon:copy"]');
    await copy.getByRole("radio", { name: "More" }).click();
    await page.keyboard.press("Escape");
    await expect(manager).toBeHidden();
    await page.getByRole("button", { name: "Close chat settings", exact: true }).click();
    await expect(chatSettingsWindow(page)).toBeHidden();
    const row = page.locator(".mari-message-actions").last();
    await expect(row.locator('[data-chat-tool-id="icon:copy"]')).toBeHidden();
    const more = row.getByRole("button", { name: "More tools", exact: true });
    await row.locator("xpath=..").hover();
    if (test.info().project.name.startsWith("mobile")) await page.locator(".mari-message-content").last().click();
    await more.click();
    await expect(row.locator('[data-chat-tool-id="icon:copy"]')).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("marinara-engine-ui") ?? ""))
      .toContain('"icon:copy":"more"');
    await page.screenshot({ path: `.tmp/ui-manager-${test.info().project.name}.png` });
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});
