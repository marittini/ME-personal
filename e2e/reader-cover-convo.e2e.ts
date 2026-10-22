import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { seedUIState, isolateSyncedUISettings } from "./ui-state-fixture";

const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

for (const mode of ["roleplay", "conversation"] as const) {
  test(`${mode}: independent cover crop and separated viewer survive reload`, async ({ page, request }) => {
    const chat = await (
      await request.post("/api/chats", { data: { name: `Cover ${mode}`, mode, characterIds: [] } })
    ).json();
    try {
      await request.post(`/api/chats/${chat.id}/messages`, {
        data: { role: "assistant", content: "A message in its own viewer." },
      });
      await isolateSyncedUISettings(page);
      await seedUIState(
        page,
        {
          hasCompletedOnboarding: true,
          sidebarOpen: false,
          rightPanelOpen: false,
          chatHelpSeenModes: ["roleplay", "conversation"],
          language: "ko",
          conversationMessageStyle: "classic",
        },
        "if-missing",
      );
      await page.addInitScript((id) => localStorage.setItem("marinara-active-chat-id", id), chat.id);
      await page.addInitScript((v) => localStorage.setItem("marinara:whats-new:seen-version", v), version);
      await page.goto("/");
      const workspace = page.locator('[data-component="ReaderWorkspace"]');
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      if (mode === "conversation") {
        await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
        await workspace.getByRole("button", { name: "읽기 설정", exact: true }).click();
        const viewer = page.getByRole("combobox", { name: "대화 뷰어", exact: true });
        await viewer.selectOption("classic");
        await expect(workspace.locator(".texting-bubble-other")).toHaveCount(0);
        await viewer.selectOption("bubble");
        await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
        await page.keyboard.press("Escape");
      } else {
        await expect(workspace.locator('[data-chat-mode="roleplay"]')).toBeVisible();
        await expect(workspace.locator(".texting-bubble-other")).toHaveCount(0);
      }
      await workspace.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
      const detail = page.locator('[data-component="LibraryWorkDetail"]');
      await detail.getByRole("button", { name: "표지 편집", exact: true }).click();
      await detail.locator('input[type="file"]').setInputFiles({
        name: "independent.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAHgAAAC0CAIAAADQLH9KAAABq0lEQVR4nO3QURFAQAAAUZRSQCcptLlcMsjgZ2+M9xLs7DrOY/ma695nJ7y2zQ74C6MjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGR4yOGB0xOmJ0xOiI0RGjI0ZHjI4YHTE6YnTE6IjREaMjRkeMjhgdMTpidMToiNERoyNGRx6tiASJHY0ZygAAAABJRU5ErkJggg==",
          "base64",
        ),
      });
      await expect(detail.getByRole("img", { name: "표지 미리보기" })).toBeVisible();
      await detail.getByRole("slider", { name: "확대", exact: true }).fill("2");
      await detail.getByRole("slider", { name: "가로 위치", exact: true }).fill("0.8");
      await detail.getByRole("button", { name: "저장", exact: true }).click();
      const cover = detail.locator('img[src*="library-cover-"]');
      await expect(cover).toBeVisible();
      const source = await cover.getAttribute("src");
      const cropStyle = await cover.getAttribute("style");
      expect(source).toContain("w=320");
      await page.reload();
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      await workspace.getByRole("button", { name: "작품 정보로 돌아가기", exact: true }).click();
      await expect(cover).toHaveAttribute("src", source!);
      await expect(cover).toHaveAttribute("style", cropStyle!);
      await detail.getByRole("button", { name: "이어 읽기", exact: true }).click();
      await expect(workspace).toHaveAttribute("data-reader-mode", mode);
      if (mode === "conversation") await expect(workspace.locator(".texting-bubble-other")).toBeVisible();
    } finally {
      await request.delete(`/api/chats/${chat.id}?force=true`);
    }
  });
}
