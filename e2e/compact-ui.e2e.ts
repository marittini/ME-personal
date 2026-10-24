import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { seedUIState } from "./ui-state-fixture.js";
import { chatSettingsWindow, openChatSettings } from "./chat-settings-tools.js";
import { serveWithServerCsp } from "./server-csp-fixture.js";

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

test("phone back walks a library tab back to Home, then needs two presses to leave", async ({ page }) => {
  test.skip(!test.info().project.name.startsWith("mobile"), "the exit guard is for the phone layout");
  await seedUIState(page, { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await page.goto("/");
  const home = page.locator('[data-component="LibraryHome"]');
  await expect(home).toBeVisible();
  await page.getByRole("button", { name: "Record", exact: true }).click();
  await expect(home.getByRole("heading", { level: 1 })).not.toHaveText("Your library");
  // Back: the tab returns to Home.
  await page.evaluate(() => history.back());
  await expect(home.getByRole("heading", { level: 1 })).toHaveText("Your library");
  // First back on Home: a hint, and the app stays.
  await page.evaluate(() => history.back());
  await expect(page.getByText("Press back again to exit", { exact: true })).toBeVisible();
  await expect(home).toBeVisible();
  // A second press within two seconds leaves the page (here: back to the blank tab it came from).
  const left = page.waitForEvent("framenavigated", { timeout: 5_000 });
  await page.evaluate(() => history.back());
  await left;
  expect(page.url()).not.toContain("127.0.0.1");
});

test("App name and icon: an uploaded icon becomes the favicon and manifest icon, the name the tab title", async ({
  page,
  request,
}) => {
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "settings",
    settingsTab: "appearance",
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  try {
    await page.goto("/");
    await page.getByPlaceholder("Search settings").fill("app icon");
    await page.locator(".mari-settings-search-header button").filter({ hasText: "App name and icon" }).first().click();
    const setting = page.locator("[data-app-branding]");
    await expect(setting).toBeVisible();
    await setting.locator('input[type="file"]').setInputFiles({
      name: "icon.png",
      mimeType: "image/png",
      buffer: readFileSync(new URL("../packages/client/public/icon-192.png", import.meta.url)),
    });
    await expect.poll(() => page.locator('link[rel="icon"]').getAttribute("href")).toContain("/api/branding/icon/64");
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute("href", /\/api\/branding\/icon\/192/);
    await setting.getByLabel("App name").fill("My Shelf");
    await setting.getByLabel("Short name (home screen)").fill("Shelf");
    await setting.getByRole("button", { name: "Save names" }).click();
    await expect(page).toHaveTitle("My Shelf");
    await setting.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `.tmp/app-branding-${test.info().project.name}.png` });
    const manifest = await (await request.get("/api/branding/manifest.json")).json();
    expect(manifest.name).toBe("My Shelf");
    expect(manifest.short_name).toBe("Shelf");
    expect(manifest.icons[2].src).toContain("/api/branding/icon/512");
    const icon = await request.get(manifest.icons[2].src);
    expect(icon.headers()["content-type"]).toBe("image/png");
    await setting.getByRole("button", { name: "Default icon" }).click();
    await expect.poll(() => page.locator('link[rel="icon"]').getAttribute("href")).toBe("/favicon.png");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/api/branding/manifest.json");
  } finally {
    await request.put("/api/branding", { data: { name: "", shortName: "" } });
    await request.delete("/api/branding/icon");
  }
});

test("web fonts: registered once, then picked in the app font list and in each mode's reading font", async ({
  page,
  request,
}) => {
  const rp = await (await request.post("/api/chats", { data: { name: "Font proof", mode: "roleplay" } })).json();
  await request.post(`/api/chats/${rp.id}/messages`, { data: { role: "assistant", content: "A line in a new face." } });
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "settings",
    settingsTab: "appearance",
    chatHelpSeenModes: ["conversation", "roleplay", "game"],
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await request.put("/api/app-settings/web-fonts", { data: { value: "" } });
  try {
    await page.goto("/");
    await page.getByPlaceholder("Search settings").fill("web font");
    await page.locator(".mari-settings-search-header button").filter({ hasText: "Web fonts" }).first().click();
    const panel = page.locator("[data-web-fonts]");
    await expect(panel).toBeVisible();
    // The registry has no per-target font, size or spacing controls any more.
    await expect(panel.locator("select")).toHaveCount(0);
    const code = panel.getByLabel("@font-face / @import code");
    // Plain HTTP font files are refused.
    await code.fill('@font-face{font-family:"Bad";src:url(http://example.com/bad.woff2)}');
    await panel.getByRole("button", { name: "Register", exact: true }).click();
    await expect(page.getByText(/HTTPS font addresses/)).toBeVisible();
    await expect(panel.locator("[data-web-font-family]")).toHaveCount(0);
    await code.fill('@font-face{font-family:"Proof Serif";src:url(https://example.com/proof.woff2) format("woff2")}');
    await panel.getByRole("button", { name: "Register", exact: true }).click();
    await expect(panel.locator('[data-web-font-family="Proof Serif"]')).toBeVisible();

    // The app font list offers it; picking it sets the app font.
    await page.getByPlaceholder("Search settings").fill("");
    const appFont = page.locator("#settings-control-font-family select");
    await appFont.scrollIntoViewIfNeeded();
    await appFont.selectOption("Proof Serif");
    await expect
      .poll(() =>
        page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--font-user").trim()),
      )
      .toBe('"Proof Serif"');
    await page.evaluate(async () => {
      const { useUIStore } = await import("/src/stores/ui.store.ts" as string);
      useUIStore.getState().setFontFamily("");
    });

    // A Roleplay room's reading settings list it under Web fonts; the choice is Roleplay's own.
    await page.evaluate((chatId) => localStorage.setItem("marinara-active-chat-id", chatId), rp.id);
    await seedUIState(page, { rightPanelOpen: false }, "merge");
    await page.reload();
    await page.getByRole("button", { name: "Reading settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
    const font = dialog.getByRole("combobox", { name: "Font", exact: true });
    await expect(font.locator('optgroup[label="Web fonts"] option')).toHaveText(["Proof Serif"]);
    await font.selectOption("custom:Proof Serif");
    await expect(page.locator("[data-reader-prose]").first()).toHaveCSS("font-family", /Proof Serif/u);
    const stored = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("marinara-engine-ui") ?? "{}").state?.readerPreferences);
    await expect.poll(async () => (await stored())?.roleplay?.font).toBe("custom:Proof Serif");
    expect((await stored()).conversation.font).toBe("");
    await page.screenshot({ path: `.tmp/reader-settings-${test.info().project.name}.png` });
  } finally {
    await request.put("/api/app-settings/web-fonts", { data: { value: "" } });
    await request.delete(`/api/chats/${rp.id}?force=true`);
  }
});

// A 600-byte WOFF whose "A" is two em wide, so a laid-out "A" shows whether the web font really loaded.
const WIDE_A_FONT = Buffer.from(
  "d09GRgABAAAAAAJcAAoAAAAAApAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAABPUy8yAAABZAAAACMAAABgQThENWNtYXAAAAGQAAAAKQAAADQADACUZ2x5ZgAAAcQAAAAuAAAAMtpcjmZoZWFkAAAA9AAAADYAAAA2NLjgeGhoZWEAAAEsAAAAHwAAACQKwAdvaG10eAAAAYgAAAAIAAAACAlgAGRsb2NhAAABvAAAAAYAAAAGABkADG1heHAAAAFMAAAAFgAAACAABAAGbmFtZQAAAfQAAABWAAAAZn6sfJpwb3N0AAACTAAAAA8AAAAmACgAAAABAAAAAQAA3sIsNV8PPPUAAwPoAAAAAOcCTm4AAAAA5wJObgAyAAAHbAK8AAAAAwACAAAAAAAAeJxjYGRgYFb4b8HAwH6BwYghhT2HASiCApgAUxwDPwB4nGNgZGBgYGJgYQDRIBYaAAABEgALAAB4nGNgZtnAOIGBlYGFgTBgRObYAwGQcgRCXECBgQEArUcC8QABkAAyB9AAMnicY2BgYGJgYGAGYhEgyQimWRgUgDQLEIL4jv//Q8j/B8B8BgBSlwadAAAAAAAADAAZAAB4nGNgZDBiYGDUYdrDwMzAYCxoLGj0i2nPXxcGsDh7DkxcUdCI3QosAQDH7gkkAAB4nC2IMQrAIAADTysUl1L6AukTHPoDd/EHDuoiCIL/r5ZeSEgCKB4EC4H+ciHZ59oQSs/n4vy75OB21hnfW8shlVFjx2GnDZ5Om8oEEoVBJdJfbe4MOAAAeJxjYGLAD0DyKgAAngApAA==",
  "base64",
);

test("web fonts: noonnu @font-face code loads under the server's Content-Security-Policy and shows in RP", async ({
  page,
  request,
}) => {
  // Owner report 2026-10-24: this exact code never applied. The server's font-src allowed only its own fonts.
  const code = `@font-face {
    font-family: 'BookkMyungjo';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.0/BookkMyungjo-Lt.woff2') format('woff2');
    font-weight: 400;
    font-display: swap;
}

@font-face {
    font-family: 'BookkMyungjo';
    src: url('https://cdn.jsdelivr.net/gh/projectnoonnu/noonfonts_2302@1.0/BookkMyungjo-Bd.woff2') format('woff2');
    font-weight: 700;
    font-display: swap;
}`;
  const rp = await (await request.post("/api/chats", { data: { name: "Bookk proof", mode: "roleplay" } })).json();
  await request.post(`/api/chats/${rp.id}/messages`, { data: { role: "assistant", content: "AAAA" } });
  await request.put("/api/app-settings/web-fonts", { data: { value: "" } });
  const fetched: string[] = [];
  await page.route("https://cdn.jsdelivr.net/gh/projectnoonnu/**", (route) => {
    fetched.push(route.request().url());
    return route.fulfill({
      body: WIDE_A_FONT,
      contentType: "font/woff2",
      headers: { "access-control-allow-origin": "*" },
    });
  });
  await serveWithServerCsp(page, ["font"]);
  await page.addInitScript(() => {
    (window as unknown as { cspFontBlocks: string[] }).cspFontBlocks = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.effectiveDirective === "font-src")
        (window as unknown as { cspFontBlocks: string[] }).cspFontBlocks.push(event.blockedURI);
    });
  });
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "settings",
    settingsTab: "appearance",
    chatHelpSeenModes: ["conversation", "roleplay", "game"],
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  try {
    await page.goto("/");
    await page.getByPlaceholder("Search settings").fill("web font");
    await page.locator(".mari-settings-search-header button").filter({ hasText: "Web fonts" }).first().click();
    const panel = page.locator("[data-web-fonts]");
    await panel.getByLabel("@font-face / @import code").fill(code);
    await panel.getByRole("button", { name: "Register", exact: true }).click();
    await expect(panel.locator('[data-web-font-family="BookkMyungjo"]')).toHaveCount(1);

    await page.evaluate((chatId) => localStorage.setItem("marinara-active-chat-id", chatId), rp.id);
    await seedUIState(page, { rightPanelOpen: false }, "merge");
    await page.reload();
    await page.getByRole("button", { name: "Reading settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
    await dialog.getByRole("combobox", { name: "Font", exact: true }).selectOption("custom:BookkMyungjo");
    await page.keyboard.press("Escape");
    const prose = page.locator("[data-reader-prose]").filter({ hasText: "AAAA" }).first();
    await expect(prose).toHaveCSS("font-family", /BookkMyungjo/u);
    // The font file was fetched, not blocked, and the text is laid out in it ("A" is two em wide in the test font).
    await expect.poll(() => fetched.length).toBeGreaterThan(0);
    await expect
      .poll(() => prose.evaluate((node) => document.fonts.check(`16px "BookkMyungjo"`) && node.scrollWidth))
      .toBeGreaterThan(0);
    const width = await prose.evaluate((node) => {
      const range = document.createRange();
      range.selectNodeContents(node);
      return range.getBoundingClientRect().width / parseFloat(getComputedStyle(node).fontSize);
    });
    expect(width).toBeGreaterThan(7);
    expect(await page.evaluate(() => (window as unknown as { cspFontBlocks: string[] }).cspFontBlocks)).toEqual([]);
  } finally {
    await request.put("/api/app-settings/web-fonts", { data: { value: "" } });
    await request.delete(`/api/chats/${rp.id}?force=true`);
  }
});

test("web fonts: earlier per-target choices move once into the app font and each mode's reading settings", async ({
  page,
  request,
}) => {
  await request.put("/api/app-settings/web-fonts", {
    data: {
      value: JSON.stringify({
        css: '@font-face{font-family:"Moved Face";src:url(https://example.com/moved.woff2)}',
        targets: {
          ui: { family: "Moved Face" },
          roleplay: { family: "Moved Face", size: 19, height: 2, spacing: 0.5 },
          conversation: { height: 1.4 },
        },
      }),
    },
  });
  try {
    await seedUIState(page, { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    await expect
      .poll(async () => JSON.parse((await (await request.get("/api/app-settings/web-fonts")).json()).value).targets)
      .toEqual({});
    const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("marinara-engine-ui") ?? "{}").state);
    await expect.poll(async () => (await state()).chatFontSize).toBe(19);
    const saved = await state();
    expect(saved.fontFamily).toBe("Moved Face");
    expect(saved.readerPreferences.roleplay).toMatchObject({
      font: "custom:Moved Face",
      lineHeight: 2,
      letterSpacing: 0.5,
    });
    expect(saved.readerPreferences.conversation).toMatchObject({ font: "", lineHeight: 1.4 });
    // The faces themselves stay registered.
    await expect
      .poll(() => page.evaluate(() => document.getElementById("marinara-web-fonts")?.textContent ?? ""))
      .toContain("Moved Face");
  } finally {
    await request.put("/api/app-settings/web-fonts", { data: { value: "" } });
  }
});

test("chat remote: on/off in the UI manager, an item placed on it, message steps, jump, and code copy", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/chats", { data: { name: "Remote proof", mode: "roleplay" } });
  const { id } = await created.json();
  try {
    for (let i = 1; i <= 8; i++)
      await request.post(`/api/chats/${id}/messages`, {
        data: {
          role: i % 2 ? "assistant" : "user",
          content:
            i === 8
              ? "Here is code:\n\n```js\nconsole.log(42);\n```"
              : `Message ${i}. ` + "A long line of story text. ".repeat(30),
        },
      });
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
    // Code blocks in messages get a copy button.
    await expect(page.locator(".mari-message-content pre.mari-md-codeblock .mari-code-copy").last()).toHaveText("Copy");
    await expect(page.locator("[data-chat-remote]")).toHaveCount(0);

    const settings = await openChatSettings(page);
    await settings.locator("[data-chat-ui-manager-button]").click();
    const manager = page.locator("[data-chat-ui-manager]");
    await manager.getByRole("tab", { name: /Remote/ }).click();
    await manager.getByRole("checkbox", { name: "Show the remote" }).check({ force: true });
    await manager.getByRole("tab", { name: /^Chat Settings/ }).click();
    await manager.locator('[data-ui-manager-item="connection"]').getByRole("radio", { name: "Remote" }).click();
    await manager.getByRole("tab", { name: /Remote/ }).click();
    await expect(manager.locator('[data-ui-manager-item="connection"]')).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close chat settings", exact: true }).click();

    const remote = page.locator("[data-chat-remote]");
    await expect(remote).toBeVisible();
    const item = remote.locator('[data-chat-remote-item="drawer:chat-settings:connection"]');
    await expect(item).toBeVisible();
    await expect(page.locator('.mari-window-bubble[data-window="drawer:chat-settings:connection"]')).toHaveCount(0);
    await page.screenshot({ path: `.tmp/chat-remote-${test.info().project.name}.png` });
    await item.click();
    await expect(page.locator('.mari-window[data-window="drawer:chat-settings:connection"]')).toBeVisible();
    await page.keyboard.press("Escape");

    // Message steps move the transcript; the jump goes to a numbered message.
    const scroll = page.locator('[data-chat-mode="roleplay"] [data-chat-scroll]').first();
    await scroll.evaluate((node) => node.scrollTo({ top: 0 }));
    const before = await scroll.evaluate((node) => node.scrollTop);
    await remote.getByRole("button", { name: "Next message" }).click();
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeGreaterThan(before);
    await remote.getByRole("button", { name: "Go to message" }).click();
    await remote.getByLabel("Number").fill("1");
    await remote.getByRole("button", { name: "Go", exact: true }).click();
    await expect.poll(() => scroll.evaluate((node) => node.scrollTop)).toBeLessThan(40);

    // Settings are kept: side, and the item's place.
    await expect
      .poll(() => page.evaluate(() => localStorage.getItem("marinara-engine-ui") ?? ""))
      .toContain('"drawer:chat-settings:connection"');
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("convo: message time follows the reading settings, new speakers start further down, bubbles keep a narrower column", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/chats", { data: { name: "Timestamp proof", mode: "conversation" } });
  const { id } = await created.json();
  try {
    await request.post(`/api/chats/${id}/messages`, { data: { role: "user", content: "Sir Ivan." } });
    await request.post(`/api/chats/${id}/messages`, {
      data: { role: "assistant", content: "What is it, Your Majesty? " + "Don't tell me you need help. ".repeat(6) },
    });
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
    const assistant = page.locator('[data-message-role="assistant"]').last();
    const stamp = assistant.locator("[data-message-timestamp]");
    await expect(stamp).toHaveText(/^Today at /u);
    const row = assistant.locator(".mari-message").first();
    expect(parseFloat(await row.evaluate((node) => getComputedStyle(node).marginTop))).toBeGreaterThanOrEqual(12);
    const body = assistant.locator(".mari-message-body--bubble").first();
    const [bodyBox, rowBox] = [await body.boundingBox(), await row.boundingBox()];
    expect(bodyBox!.width).toBeLessThanOrEqual(rowBox!.width * 0.83);

    await page.getByRole("button", { name: "Reading settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
    const select = dialog.getByRole("combobox", { name: "Message time", exact: true });
    await select.selectOption("time");
    await expect(stamp).not.toHaveText(/Today/u);
    await expect(stamp).toHaveText(/\d{1,2}:\d{2}/u);
    await select.selectOption("hidden");
    await expect(assistant.locator("[data-message-timestamp]")).toHaveCount(0);
    await select.selectOption("datetime");
    await expect(stamp).toHaveText(/^Today at /u);
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("library home: no new-work shortcut; Continue reading has no time, the arrow at the top and the cover's height", async ({
  page,
  request,
}) => {
  const created = await request.post("/api/chats", { data: { name: "Continue proof", mode: "roleplay" } });
  const { id } = await created.json();
  try {
    await request.post(`/api/chats/${id}/messages`, {
      data: { role: "assistant", content: "A short opening for the excerpt." },
    });
    await seedUIState(page, { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    const home = page.locator('[data-component="LibraryHome"]');
    await expect(home.getByRole("button", { name: "Choose a character for a new work" })).toHaveCount(0);
    const cover = home.locator("[data-continue-cover]");
    const info = home.locator("[data-continue-info]");
    await expect(info).toBeVisible();
    const [coverBox, infoBox, arrowBox] = [
      await cover.boundingBox(),
      await info.boundingBox(),
      await home.locator("[data-continue-arrow]").boundingBox(),
    ];
    expect(Math.abs(coverBox!.height - infoBox!.height)).toBeLessThan(1);
    expect(Math.abs(coverBox!.y - infoBox!.y)).toBeLessThan(1);
    expect(arrowBox!.y).toBeLessThan(infoBox!.y + 40);
    await expect(info).not.toContainText(/\d{1,2}:\d{2}/u);
    await page.screenshot({ path: `.tmp/library-continue-${test.info().project.name}.png` });
  } finally {
    await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("theme placeholders: personas, lorebooks and connections use the accent, no green glow behind personas", async ({
  page,
  request,
}) => {
  const lorebook = await (await request.post("/api/lorebooks", { data: { name: "Tint lorebook" } })).json();
  try {
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: "lorebooks",
    });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    await page.goto("/");
    const row = page.locator("[data-receipt-row]:visible").filter({ hasText: "Tint lorebook" });
    await expect(row.locator(".mari-avatar-placeholder--lorebook")).toBeVisible();
    const looks = await page.evaluate(() =>
      Object.fromEntries(
        ["character", "persona", "lorebook", "connection"].map((kind) => {
          const node = document.createElement("div");
          node.className = `mari-avatar-placeholder mari-avatar-placeholder--${kind}`;
          document.body.append(node);
          const style = getComputedStyle(node);
          const look = { background: style.backgroundImage, shadow: style.boxShadow };
          node.remove();
          return [kind, look];
        }),
      ),
    );
    for (const kind of ["persona", "lorebook", "connection"])
      expect(looks[kind]!.background).toBe(looks.character!.background);
    expect(looks.persona!.background).not.toContain("52, 211, 153");
    // Only the inner highlight is left behind a persona picture.
    expect(looks.persona!.shadow.split("inset")).toHaveLength(2);
    expect(looks.persona!.shadow).not.toMatch(/\) 0px 4px/u);
  } finally {
    await request.delete(`/api/lorebooks/${lorebook.id}`);
  }
});

test("roleplay hides character names; Convo translations sit close under their bubble", async ({ page, request }) => {
  const rp = await (await request.post("/api/chats", { data: { name: "Name proof", mode: "roleplay" } })).json();
  const convo = await (await request.post("/api/chats", { data: { name: "Gap proof", mode: "conversation" } })).json();
  try {
    await request.post(`/api/chats/${rp.id}/messages`, { data: { role: "user", content: "Hello there." } });
    await request.post(`/api/chats/${rp.id}/messages`, { data: { role: "assistant", content: "General Kenobi." } });
    const content = "What is it, Your Majesty?";
    const message = await (
      await request.post(`/api/chats/${convo.id}/messages`, { data: { role: "assistant", content } })
    ).json();
    await request.patch(`/api/chats/${convo.id}/messages/${message.id}/extra`, {
      data: { translation: "무슨 일이십니까, 폐하?", translationSource: content, translationHidden: false },
    });
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: false,
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    const openChat = async (id: string) => {
      await page.addInitScript(
        ({ id, version }) => {
          localStorage.setItem("marinara-active-chat-id", id);
          localStorage.setItem("marinara:whats-new:seen-version", version);
        },
        { id, version },
      );
      await page.goto("/");
    };
    await openChat(rp.id);
    const assistant = page.locator('[data-chat-mode="roleplay"] [data-message-role="assistant"]').last();
    await expect(assistant).toContainText("General Kenobi.");
    await expect(assistant.locator(".mari-message-name")).toBeHidden();

    await openChat(convo.id);
    const owner = page.locator(`[data-message-id="${message.id}"]`);
    const bubble = owner.locator(".texting-bubble-other").first();
    const translation = owner.locator('[data-conversation-translation="outside"]').first();
    await expect(translation).toContainText("폐하");
    const [bubbleBox, textBox] = [
      await bubble.boundingBox(),
      await translation.locator(".translation-text").boundingBox(),
    ];
    expect(textBox!.y - (bubbleBox!.y + bubbleBox!.height)).toBeLessThanOrEqual(10);
  } finally {
    await request.delete(`/api/chats/${rp.id}?force=true`);
    await request.delete(`/api/chats/${convo.id}?force=true`);
  }
});

test("TTS: persona voices are added only when needed; RP rooms read tagged speakers by default", async ({
  page,
  request,
}, testInfo) => {
  test.skip(!testInfo.project.name.includes("desktop"), "TTS settings are covered on desktop.");
  const config: Record<string, unknown> = {
    enabled: true,
    source: "elevenlabs",
    baseUrl: "https://api.elevenlabs.io",
    apiKey: "••••••",
    voice: "voice-01",
    model: "eleven_multilingual_v2",
    speed: 1,
    voiceMode: "per-character",
    voiceAssignments: [],
    personaVoiceAssignments: [],
    sourceProfiles: {},
  };
  const persona = await (
    await request.post("/api/characters/personas", { data: { name: `Voice persona ${Date.now()}` } })
  ).json();
  const chat = await (await request.post("/api/chats", { data: { name: "Tagged proof", mode: "roleplay" } })).json();
  try {
    await page.route("**/api/tts/config", async (route) => {
      if (route.request().method() === "PUT") {
        Object.assign(config, route.request().postDataJSON());
        await route.fulfill({ status: 204 });
        return;
      }
      await route.fulfill({ json: config });
    });
    await page.route("**/api/tts/voices", (route) =>
      route.fulfill({
        json: {
          voices: ["voice-01", "voice-02"],
          voiceOptions: ["voice-01", "voice-02"].map((id) => ({ id, name: id, previewUrl: null, labels: {} })),
          fromProvider: true,
          source: "elevenlabs",
        },
      }),
    );
    await page.route("**/api/tts/models", (route) =>
      route.fulfill({ json: { models: [{ id: "eleven_multilingual_v2", name: "v2" }], fromProvider: true } }),
    );
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(page, {
      hasCompletedOnboarding: true,
      sidebarOpen: false,
      rightPanelOpen: true,
      rightPanel: "connections",
      chatHelpSeenModes: ["conversation", "roleplay", "game"],
    });
    await page.addInitScript(
      ({ id, version }) => {
        localStorage.setItem("marinara-active-chat-id", id);
        localStorage.setItem("marinara:whats-new:seen-version", version);
      },
      { id: chat.id, version },
    );
    await page.goto("/");
    const ttsCard = page
      .locator('[data-component="RightPanel"]')
      .getByText("Text to Speech", { exact: true })
      .locator("xpath=../../..");
    await ttsCard.getByTitle("Expand").click();
    // No persona is listed until one is added.
    await expect(ttsCard.locator("[data-persona-voice-row]")).toHaveCount(0);
    await ttsCard.getByRole("button", { name: "Add persona voice", exact: true }).click();
    // One row for the first persona without a voice; it is saved with the config.
    await expect(ttsCard.locator("[data-persona-voice-row]")).toHaveCount(1);
    await expect.poll(() => (config.personaVoiceAssignments as unknown[]).length).toBe(1);
    await ttsCard.getByRole("button", { name: "Remove persona voice" }).click();
    await expect(ttsCard.locator("[data-persona-voice-row]")).toHaveCount(0);
    await expect.poll(() => (config.personaVoiceAssignments as unknown[]).length).toBe(0);

    // A room that never chose a speaker mode reads tagged participant voices.
    await page.getByRole("button", { name: "Reading settings", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
    await dialog.locator('[data-reader-settings-group="voice"] > summary').click();
    await expect(dialog.getByRole("combobox", { name: "Dialogue speaker mode", exact: true })).toHaveValue("tagged");
  } finally {
    await request.delete(`/api/characters/personas/${persona.id}`);
    await request.delete(`/api/chats/${chat.id}?force=true`);
  }
});

for (const [via, from] of [
  ["the back button", "Home"],
  ["phone back", "Home"],
  ["phone back", "Library"],
  ["phone back", "a restored chat"],
  ["the back button", "a restored chat"],
] as const) {
  test(`phone: chat from ${from} → ${via} → work information → back returns Home, not out of the app`, async ({
    page,
    request,
  }) => {
    test.skip(!test.info().project.name.startsWith("mobile"), "phone back navigation");
    const { id } = await (await request.post("/api/chats", { data: { name: "Back Proof", mode: "roleplay" } })).json();
    try {
      await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content: "Opening line." } });
      await seedUIState(page, { hasCompletedOnboarding: true, sidebarOpen: false, rightPanelOpen: false });
      await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
      await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
      // The installed web app reopens the last chat directly; the library was never shown in this session.
      if (from === "a restored chat")
        await page.addInitScript((chatId) => localStorage.setItem("marinara-active-chat-id", chatId), id);
      await page.goto("/");
      const home = page.locator('[data-component="LibraryHome"]');
      if (from !== "a restored chat") await expect(home).toBeVisible();
      if (from === "Library") await page.getByRole("button", { name: "Library", exact: true }).click();
      if (from !== "a restored chat") await page.getByRole("button").filter({ hasText: "Back Proof" }).first().click();
      // From the Library tab a work opens its information first; Continue reading enters the chat.
      if (from === "Library") await page.getByRole("button", { name: "Continue reading", exact: true }).click();
      const backToWork = page.getByRole("button", { name: "Back to work information", exact: true });
      await expect(backToWork).toBeVisible();
      if (via === "phone back") await page.evaluate(() => history.back());
      else await backToWork.click();
      const detail = page.locator('[data-component="LibraryWorkDetail"]');
      await expect(detail).toBeVisible();
      // Record tools are small and sit together at the right edge.
      const row = detail.locator("[data-record-depth]").first();
      const [rowBox, renameBox, deleteBox] = await Promise.all([
        row.boundingBox(),
        row.locator('[data-record-action="rename"]').boundingBox(),
        row.locator('[data-record-action="delete"]').boundingBox(),
      ]);
      expect(renameBox!.width).toBeLessThanOrEqual(30);
      expect(deleteBox!.x - (renameBox!.x + renameBox!.width)).toBeLessThanOrEqual(1);
      expect(rowBox!.x + rowBox!.width - (deleteBox!.x + deleteBox!.width)).toBeLessThanOrEqual(-4);
      await page.evaluate(() => history.back());
      await expect(home).toBeVisible();
      await expect(detail).toHaveCount(0);
      expect(page.url()).toContain("127.0.0.1");
      if (from === "Library") {
        await page.evaluate(() => history.back());
        await expect(home.getByRole("heading", { level: 1 })).toHaveText("Your library");
      }
      // Home still asks for a second press before leaving.
      await page.evaluate(() => history.back());
      await expect(page.getByText("Press back again to exit", { exact: true })).toBeVisible();
      await expect(home).toBeVisible();
    } finally {
      await request.delete(`/api/chats/${id}?force=true`);
    }
  });
}

test("phone: a panel opened on the library home starts right under the Marinara Library line", async ({ page }) => {
  test.skip(!test.info().project.name.startsWith("mobile"), "phone panels");
  await seedUIState(page, {
    hasCompletedOnboarding: true,
    sidebarOpen: false,
    rightPanelOpen: true,
    rightPanel: "connections",
  });
  await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
  await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
  await page.goto("/");
  const home = page.locator('[data-component="LibraryHome"]');
  const panel = page.locator(
    '[data-component="RightPanelMobile"]:visible, [data-component="ChatSidebarPanel"]:visible',
  );
  await expect(panel.first()).toBeVisible();
  const [brand, title, panelBox] = await Promise.all([
    home.locator("header p").first().boundingBox(),
    home.getByRole("heading", { level: 1 }).boundingBox(),
    panel.first().boundingBox(),
  ]);
  // Covers the page title, leaves the brand line visible.
  expect(Math.abs(panelBox!.y - (title!.y - 2))).toBeLessThan(1.5);
  expect(panelBox!.y).toBeGreaterThanOrEqual(brand!.y + brand!.height);
});

test("UI manager: rows share columns, and a remote choice follows into another room of the same mode", async ({
  page,
  request,
}) => {
  const ids: string[] = [];
  for (const name of ["Layout room A", "Layout room B"]) {
    const { id } = await (await request.post("/api/chats", { data: { name, mode: "roleplay" } })).json();
    ids.push(id);
    await request.post(`/api/chats/${id}/messages`, { data: { role: "assistant", content: `${name} opening.` } });
  }
  try {
    await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
    await seedUIState(
      page,
      {
        hasCompletedOnboarding: true,
        sidebarOpen: false,
        rightPanelOpen: false,
        chatHelpSeenModes: ["conversation", "roleplay", "game"],
      },
      "merge",
    );
    await page.addInitScript((value) => localStorage.setItem("marinara:whats-new:seen-version", value), version);
    const openRoom = async (id: string) => {
      await page.evaluate((chatId) => localStorage.setItem("marinara-active-chat-id", chatId), id);
      await page.reload();
    };
    await page.goto("/");
    await openRoom(ids[0]!);
    const settings = await openChatSettings(page);
    await settings.locator("[data-chat-ui-manager-button]").click();
    const manager = page.locator("[data-chat-ui-manager]");
    await manager.getByRole("tab", { name: /^Chat Settings/ }).click();
    await manager.locator('[data-ui-manager-item="connection"]').getByRole("radio", { name: "Hidden" }).click();
    // Every placement control starts at the same x, hidden rows included.
    const starts = await manager
      .locator(".mari-ui-manager__row > .mari-ui-manager__segmented")
      .evaluateAll((nodes) => nodes.map((node) => Math.round(node.getBoundingClientRect().left)));
    expect(starts.length).toBeGreaterThan(3);
    expect(new Set(starts).size).toBe(1);
    // The placement control never runs under the order buttons beside it.
    const overlaps = await manager.locator(".mari-ui-manager__row").evaluateAll(
      (rows) =>
        rows.filter((row) => {
          const seg = row.querySelector(".mari-ui-manager__segmented")?.getBoundingClientRect();
          const moves = row.querySelector(".mari-ui-manager__moves button")?.getBoundingClientRect();
          return seg && moves && seg.right > moves.left;
        }).length,
    );
    expect(overlaps).toBe(0);
    // Names stay readable, and rows stay inside the manager.
    const box = (await manager.boundingBox())!;
    const rows = await manager.locator(".mari-ui-manager__row").evaluateAll((nodes) =>
      nodes.map((row) => ({
        name: row.querySelector(".mari-ui-manager__name")!.getBoundingClientRect().width,
        right: Math.max(...Array.from(row.children).map((child) => child.getBoundingClientRect().right)),
      })),
    );
    for (const row of rows) {
      expect(row.name).toBeGreaterThan(40);
      expect(row.right).toBeLessThanOrEqual(box.x + box.width + 1);
    }
    await page.screenshot({ path: `.tmp/ui-manager-${test.info().project.name}.png` });
    await manager.locator('[data-ui-manager-item="connection"]').getByRole("radio", { name: "Remote" }).click();
    await manager.getByRole("tab", { name: /Remote/ }).click();
    await manager.getByRole("checkbox", { name: "Show the remote" }).check({ force: true });
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close chat settings", exact: true }).click();
    const item = page.locator('[data-chat-remote] [data-chat-remote-item="drawer:chat-settings:connection"]');
    await expect(item).toBeVisible();

    // Another RP room shows the same item on its remote without opening Chat Settings first.
    await openRoom(ids[1]!);
    await expect(page.locator('[data-chat-mode="roleplay"]')).toContainText("Layout room B opening.");
    await expect(item).toBeVisible();
  } finally {
    for (const id of ids) await request.delete(`/api/chats/${id}?force=true`);
  }
});

test("NovelAI: prompt and negative prefixes are still there when the connection is opened again", async ({
  page,
  request,
}) => {
  // Owner report 2026-10-24: open a NovelAI connection, write the prefixes, leave, open it again — they were blank.
  const conn = await (
    await request.post("/api/connections", {
      data: {
        name: `NAI reopen proof ${Date.now()}`,
        provider: "image_generation",
        imageGenerationSource: "novelai",
        imageService: "novelai",
        model: "nai-diffusion-4-5-full",
      },
    })
  ).json();
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
    const row = page.locator("[data-receipt-row]:visible").filter({ hasText: conn.name });
    const editor = page.locator(".mari-editor-shell");
    await row.click();
    await editor.getByRole("button", { name: /NovelAI generation setup/iu }).click();
    await editor.getByLabel("Prompt Prefix").fill("masterpiece, best quality");
    await editor.getByLabel("Negative Prefix").fill("lowres, blurry");
    // On phones a notice can sit over the Save button; the keyboard reaches it all the same.
    await editor.getByRole("button", { name: "Save", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect
      .poll(async () => (await (await request.get(`/api/connections/${conn.id}`)).json()).defaultParameters ?? "")
      .toContain("lowres, blurry");
    await expect(editor.getByText("Unsaved", { exact: true })).toHaveCount(0);
    // Leave the editor: back on a computer; a phone's back closes the panel too, so it comes back with a reload.
    if (test.info().project.name.startsWith("mobile")) await page.reload();
    else await page.evaluate(() => history.back());
    await expect(editor).toBeHidden();
    await row.click();
    await expect(editor).toBeVisible();
    const prefix = editor.getByLabel("Prompt Prefix");
    if (!(await prefix.isVisible())) await editor.getByRole("button", { name: /NovelAI generation setup/iu }).click();
    await expect(prefix).toHaveValue("masterpiece, best quality");
    await expect(editor.getByLabel("Negative Prefix")).toHaveValue("lowres, blurry");
  } finally {
    await request.delete(`/api/connections/${conn.id}`);
  }
});
