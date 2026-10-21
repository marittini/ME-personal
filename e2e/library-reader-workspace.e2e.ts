import { expect, test } from "@playwright/test";
import { seedUIState } from "./ui-state-fixture.js";
import { readFileSync } from "node:fs";

const version = (JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string })
  .version;

for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: reading, writing, settings, return and record deletion`, async ({ page, request }) => {
    const response = await request.post("/api/chats", {
      data: { name: `Reader proof ${mode}`, mode, characterIds: [] },
    });
    expect(response.ok()).toBeTruthy();
    const chat = (await response.json()) as { id: string };
    try {
      for (let index = 0; index < 8; index++) {
        expect(
          (
            await request.post(`/api/chats/${chat.id}/messages`, {
              data: { role: "assistant", content: `Paragraph ${index}. ` + "A quiet reading passage. ".repeat(40) },
            })
          ).ok(),
        ).toBeTruthy();
      }
      await page.route("**/api/app-settings/ui", (route) => route.fulfill({ json: { value: "" } }));
      await seedUIState(
        page,
        {
          hasCompletedOnboarding: true,
          sidebarOpen: false,
          rightPanelOpen: false,
          chatHelpSeenModes: ["roleplay", "conversation", "game"],
        },
        "if-missing",
      );
      await page.addInitScript((id) => {
        localStorage.setItem("marinara-active-chat-id", id);
      }, chat.id);
      await page.addInitScript((value) => {
        localStorage.setItem("marinara:whats-new:seen-version", value);
      }, version);
      await page.goto("/");
      const workspace = page.locator('[data-component="ReaderWorkspace"]');
      await expect(workspace).toHaveAttribute("data-reader-enabled", "true");
      await expect(workspace.locator(".mari-message-content").first()).toBeVisible();
      const composer = workspace.locator(".chat-input-container");
      await expect(composer).toBeVisible();
      await workspace.getByRole("button", { name: "Read without the composer", exact: true }).click();
      await expect(composer).toBeHidden();
      await workspace.getByRole("button", { name: "Write", exact: true }).click();
      await expect(composer).toBeVisible();
      await workspace.getByRole("button", { name: "Reading settings", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Reading settings", exact: true });
      await dialog.getByRole("combobox", { name: "Typeface", exact: true }).selectOption("serif");
      await expect(workspace.locator(".mari-message-content").first()).toHaveCSS("font-family", /Georgia/);
      await page.keyboard.press("Escape");
      await workspace.locator("[data-chat-scroll]").evaluate((area) => {
        area.scrollTop = area.scrollHeight / 3;
        area.dispatchEvent(new Event("scroll"));
      });
      await workspace.getByRole("button", { name: "Back to work information", exact: true }).click();
      const detail = page.locator('[data-component="LibraryWorkDetail"]');
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: "Continue reading", exact: true }).click();
      await expect(workspace).toHaveAttribute("data-reader-enabled", "true");
      await page.reload();
      await expect(workspace.locator(".mari-message-content").first()).toHaveCSS("font-family", /Georgia/);
      await workspace.getByRole("button", { name: "Back to work information", exact: true }).click();
      await expect(detail).toBeVisible();
      await detail.getByRole("button", { name: `Rename Reader proof ${mode}`, exact: true }).click();
      const rename = page.getByRole("dialog");
      await rename.getByRole("textbox").fill(`Renamed ${mode}`);
      await rename.getByRole("button", { name: "Save", exact: true }).click();
      await expect(detail.getByRole("button", { name: `Delete Renamed ${mode}`, exact: true })).toBeVisible();
      await detail.getByRole("button", { name: `Delete Renamed ${mode}`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Cancel", exact: true }).click();
      expect((await request.get(`/api/chats/${chat.id}`)).ok()).toBeTruthy();
      await page.route(`**/api/chats/${chat.id}?force=true`, (route) =>
        route.fulfill({ status: 500, json: { error: "Synthetic delete failure" } }),
      );
      await detail.getByRole("button", { name: `Delete Renamed ${mode}`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete record", exact: true }).click();
      await expect(
        page.getByText("Couldn't delete the conversation. It has been restored.", { exact: true }),
      ).toBeVisible();
      await expect(detail).toBeVisible();
      await page.unroute(`**/api/chats/${chat.id}?force=true`);
      await detail.getByRole("button", { name: `Delete Renamed ${mode}`, exact: true }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Delete record", exact: true }).click();
      await expect(detail).toBeHidden();
      await expect.poll(async () => (await request.get(`/api/chats/${chat.id}`)).status()).toBe(404);
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
    }
  });
}
