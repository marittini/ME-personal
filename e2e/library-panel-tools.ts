import type { Locator, Page } from "@playwright/test";

/** The visible library panel's toolbar (create · search · more); hidden panels stay mounted. */
export const libraryPanelToolbar = (scope: Page | Locator) => scope.locator("[data-library-toolbar]:visible").first();

/** Runs one of the actions behind the toolbar's ⋯ button (Download, Open Library, Import, Select). */
export async function chooseLibraryPanelAction(scope: Page | Locator, name: string | RegExp) {
  const toolbar = libraryPanelToolbar(scope);
  await toolbar.getByRole("button", { name: "More actions", exact: true }).click();
  await toolbar
    .page()
    .getByRole("menuitem", { name, exact: typeof name === "string" })
    .click();
}

/** Shows the panel's search and sort row. */
export async function openLibraryPanelSearch(scope: Page | Locator) {
  const toggle = libraryPanelToolbar(scope).getByRole("button", { name: "Search", exact: true });
  if ((await toggle.getAttribute("aria-pressed")) !== "true") await toggle.click();
}
