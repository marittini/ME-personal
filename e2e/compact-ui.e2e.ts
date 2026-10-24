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
    // Tokens read like a price: the bare number, with the unit once in the column line.
    await expect(value).toHaveText(/^\d[\d,]*$/u);
    await expect(page.locator("[data-receipt-columns]:visible")).toContainText(/Tokens/i);
    // One line of icons replaces the download/library and search/sort rows.
    const toolbar = page.locator("[data-library-toolbar]:visible");
    await expect(page.getByPlaceholder("Search characters", { exact: true })).toBeHidden();
    await toolbar.getByRole("button", { name: "Search", exact: true }).click();
    await page.getByPlaceholder("Search characters", { exact: true }).fill("Label Beta");
    await expect(page.locator("[data-receipt-row]").filter({ hasText: "Label Alpha" })).toBeHidden();
    await toolbar.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.locator("[data-receipt-row]").filter({ hasText: "Label Alpha" })).toBeVisible();
    await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText([
      "Download character cards",
      "Open Library",
      "Import",
      "Select",
    ]);
    await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
    await expect(page.getByRole("menu")).toHaveCount(0);
    // Row tools: bare icons on hover; on a phone they wait behind the row's ⋯ button.
    const tools = row.locator("[data-character-row-actions]");
    if (test.info().project.name.startsWith("mobile")) {
      await expect(tools).toHaveCSS("opacity", "0");
      await row.getByRole("button", { name: "Tools", exact: true }).click();
      await expect(tools).toHaveCSS("opacity", "1");
      // The tap stays on the row's tools instead of opening the character.
      await expect(row).toBeVisible();
    } else {
      await row.hover();
      await expect(tools).toHaveCSS("opacity", "1");
      await expect(row.getByRole("button", { name: "Tools", exact: true })).toBeHidden();
    }
    await expect(tools.getByRole("button", { name: "Duplicate", exact: true })).toHaveCSS(
      "background-color",
      "rgba(0, 0, 0, 0)",
    );
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

    // Placement lives in the UI manager: no per-drawer pop-out buttons inside Chat Settings.
    await expect(settings.locator('[data-chat-settings-tab] [data-drawer-control="pop-out"]').first()).toBeHidden();
    await settings.locator("[data-chat-ui-manager-button]").click();
    const manager = page.locator("[data-chat-ui-manager]");
    await expect(manager).toBeVisible();
    if (!test.info().project.name.startsWith("mobile")) {
      // On a computer the manager opens beside Chat Settings instead of over it.
      const [a, b] = [await manager.boundingBox(), await settings.boundingBox()];
      expect(a!.x + a!.width <= b!.x + 1 || a!.x >= b!.x + b!.width - 1 || a!.y + a!.height <= b!.y + 1).toBe(true);
      await expect(manager.getByRole("tab").first()).toContainText(/\d/);
    }
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
    if (!test.info().project.name.startsWith("mobile")) {
      await expect(bubble).toBeVisible();
      // It joins the top row, to the left of the Chat Settings button.
      const [own, anchor] = [
        await bubble.boundingBox(),
        await page.locator("[data-chat-settings-button]").boundingBox(),
      ];
      expect(Math.abs(own!.y - anchor!.y)).toBeLessThan(2);
      expect(own!.x + own!.width).toBeLessThanOrEqual(anchor!.x);
    }
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
    const more = row.locator("[data-message-tools-more] button");
    await expect(more).toHaveAccessibleName("More tools");
    await row.locator("xpath=..").hover();
    if (test.info().project.name.startsWith("mobile")) await page.locator(".mari-message-content").last().click();
    await more.click();
    // The open menu lists it as a named row below the tools; Escape closes it.
    const copyRow = row.locator('[data-chat-tool-id="icon:copy"]');
    await expect(copyRow).toBeVisible();
    await expect(copyRow).toHaveCSS("position", "absolute");
    await expect(copyRow).toHaveAttribute("data-chat-tool-label", /Copy/);
    expect((await copyRow.boundingBox())!.y).toBeGreaterThan((await more.boundingBox())!.y);
    await page.screenshot({ path: `.tmp/more-menu-${test.info().project.name}.png` });
    await page.keyboard.press("Escape");
    await expect(copyRow).toBeHidden();
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("marinara-engine-ui") ?? ""))
      .toContain('"icon:copy":"more"');
    await page.screenshot({ path: `.tmp/ui-manager-${test.info().project.name}.png` });
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("Settings offers the four page colors; a pick sets the app theme, survives a reload and matches reading settings", async ({
  page,
}) => {
  await seedUIState(
    page,
    {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: "settings",
      settingsTab: "appearance",
    },
    "if-missing",
  );
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await page.goto("/");
  await page.getByPlaceholder("Search settings").fill("page color");
  await page.locator(".mari-settings-search-header button").filter({ hasText: "Page color" }).first().click();
  const picker = page.locator("#settings-control-theme-mode [data-reader-page-picker]");
  await expect(picker.getByRole("radio")).toHaveCount(4);
  await expect(page.locator("#settings-control-theme-mode select")).toHaveCount(0);
  await picker.getByRole("radio", { name: "Black" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await picker.getByRole("radio", { name: "Cream" }).click();
  await expect(picker.getByRole("radio", { name: "Cream" })).toHaveAttribute("aria-checked", "true");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("marinara-engine-ui") ?? ""))
    .toContain('"page":"cream"');
  await page.reload();
  await page.getByPlaceholder("Search settings").fill("page color");
  await page.locator(".mari-settings-search-header button").filter({ hasText: "Page color" }).first().click();
  await expect(picker.getByRole("radio", { name: "Cream" })).toHaveAttribute("aria-checked", "true");
});

test("work information: the cover and the text block share one height, Continue reading is a slim bar", async ({
  page,
  request,
}) => {
  const { id } = await (await request.post("/api/chats", { data: { name: "Cover Proof", mode: "roleplay" } })).json();
  try {
    await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content: "Opening line." } });
    await seedUIState(page, { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    // The newest work opens straight into the reader; its back button leads to the work information.
    await page.getByRole("button").filter({ hasText: "Cover Proof" }).first().click();
    await page.getByRole("button", { name: "Back to work information", exact: true }).click();
    const detail = page.locator('[data-component="LibraryWorkDetail"]');
    await expect(detail).toBeVisible();
    const [cover, info, bar] = await Promise.all([
      detail.locator("[data-work-cover-cell]").boundingBox(),
      detail.locator("[data-work-info-cell]").boundingBox(),
      detail.locator("[data-work-continue]").boundingBox(),
    ]);
    expect(Math.abs(cover!.y - info!.y)).toBeLessThan(1);
    expect(Math.abs(cover!.height - info!.height)).toBeLessThan(1);
    expect(bar!.height).toBeLessThanOrEqual(40);
    expect(Math.abs(bar!.y + bar!.height - (cover!.y + cover!.height))).toBeLessThan(1);
    await page.screenshot({ path: `.tmp/work-detail-${test.info().project.name}.png` });
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

for (const [panel, placeholder, items] of [
  ["lorebooks", "Search lorebooks", ["Import", "Select"]],
  ["presets", "Search presets", ["Import", "Select presets"]],
  ["connections", "Search connections", ["Import", "Select connections"]],
  ["agents", null, ["Download Agents", "Import agents", "Select agents"]],
] as const) {
  test(`${panel} panel opens with the same icon line: new · search · more`, async ({ page }) => {
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: panel,
    });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    const toolbar = page.locator("[data-library-toolbar]:visible");
    await expect(toolbar.getByRole("button")).toHaveCount(3);
    if (placeholder) {
      await expect(page.getByPlaceholder(placeholder, { exact: true })).toBeHidden();
      await toolbar.getByRole("button", { name: "Search", exact: true }).click();
      await expect(page.getByPlaceholder(placeholder, { exact: true })).toBeVisible();
    }
    await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
    await expect(page.getByRole("menuitem")).toHaveText([...items]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
  });
}

test("connections: folder rows share one list, the model sits under the name, Name lines up with names", async ({
  page,
  request,
}) => {
  const folder = await (await request.post("/api/connection-folders", { data: { name: "Label folder" } })).json();
  const conns = await Promise.all(
    ["Label conn 1", "Label conn 2", "Label conn 3"].map(async (name, index) =>
      (
        await request.post("/api/connections", {
          data: { name, provider: "openai", model: `label-model-${index}`, apiKey: "x" },
        })
      ).json(),
    ),
  );
  await request.post("/api/connection-folders/reorder-connections", {
    data: { folderId: folder.id, orderedConnectionIds: conns.slice(0, 2).map((c) => c.id) },
  });
  try {
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: "connections",
    });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    const header = page.locator("[data-receipt-folder]:visible").filter({ hasText: "Label folder" });
    if ((await header.getAttribute("aria-expanded")) !== "true") await header.click();
    const first = page.locator("[data-receipt-row]:visible").filter({ hasText: "Label conn 1" });
    const second = page.locator("[data-receipt-row]:visible").filter({ hasText: "Label conn 2" });
    await expect(second).toBeVisible();
    // Both folder rows sit in the same list: one hairline between them, no bar per row.
    expect(
      await first.evaluate((row, other) => row.parentElement === other?.parentElement, await second.elementHandle()),
    ).toBe(true);
    expect(parseFloat(await second.evaluate((row) => getComputedStyle(row).borderTopWidth))).toBe(1);
    await expect(first).toContainText("label-model-0");
    await expect(first.locator("[data-receipt-value]")).toHaveCount(0);
    // The local model card stays out of the panel.
    await expect(page.locator("[data-local-model-card]")).toBeHidden();
    const nameLabel = page.locator("[data-receipt-columns]:visible > :first-child");
    const rootName = page
      .locator("[data-receipt-row]:visible")
      .filter({ hasText: "Label conn 3" })
      .locator(".font-medium")
      .first();
    const [labelBox, nameBox] = [await nameLabel.boundingBox(), await rootName.boundingBox()];
    const labelStart = labelBox!.x + parseFloat(await nameLabel.evaluate((n) => getComputedStyle(n).paddingLeft));
    expect(Math.abs(labelStart - nameBox!.x)).toBeLessThan(6);
  } finally {
    for (const conn of conns) await request.delete(`/api/connections/${conn.id}`);
    await request.delete(`/api/connection-folders/${folder.id}`);
  }
});

test("Settings tabs sit in one row of six", async ({ page }) => {
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "settings",
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await page.goto("/");
  const tabs = page.locator("[data-settings-tabs] [role=tab]");
  await expect(tabs).toHaveCount(6);
  const ys = await tabs.evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().top)));
  expect(new Set(ys).size).toBe(1);
});
