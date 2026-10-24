// ──────────────────────────────────────────────
// LibraryPanelToolbar — one line of thin icons above a library list (characters, personas):
// create, a search toggle and a menu holding the less frequent actions.
// ──────────────────────────────────────────────
import { useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { MoreHorizontal, Plus, Search } from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "../ui/ContextMenu";

export function LibraryPanelToolbar({
  component,
  onCreate,
  searchOpen,
  onToggleSearch,
  menuItems,
  children,
}: {
  /** data-component name kept for the panel's existing hooks. */
  component: string;
  onCreate: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  menuItems: ContextMenuItem[];
  /** The search and sort row, shown while search is open. */
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  return (
    <>
      <div data-component={component} data-library-toolbar="" className="mari-library-toolbar">
        <button
          type="button"
          onClick={onCreate}
          className="mari-library-toolbar__button"
          title={t("ui.lorebooks.lorebookassignmentsection.new")}
          aria-label={t("ui.lorebooks.lorebookassignmentsection.new")}
        >
          <Plus size="1rem" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onToggleSearch}
          aria-pressed={searchOpen}
          className="mari-library-toolbar__button"
          title={t("ui.panels.libraryToolbar.search")}
          aria-label={t("ui.panels.libraryToolbar.search")}
        >
          <Search size="0.9375rem" strokeWidth={1.75} />
        </button>
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          // The open menu closes on any outside press; this press toggles it instead of reopening it.
          onMouseDown={(event) => menu && event.stopPropagation()}
          onClick={(event) => {
            if (menu) return setMenu(null);
            const rect = event.currentTarget.getBoundingClientRect();
            setMenu({ x: rect.right - 192, y: rect.bottom + 4 });
          }}
          className="mari-library-toolbar__button"
          title={t("ui.panels.libraryToolbar.more")}
          aria-label={t("ui.panels.libraryToolbar.more")}
        >
          <MoreHorizontal size="1rem" strokeWidth={1.75} />
        </button>
      </div>
      {searchOpen && children}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} />}
    </>
  );
}

/**
 * On touch screens a library row's tools stay hidden until this ⋯ button opens them. It marks its row
 * with `data-actions-open` (the row's tool classes key off that attribute) and closes any other open row.
 * ponytail: the open row lives on the DOM instead of in each panel's state, so the six list panels share
 * this button without threading props; move it into a shared store if a panel ever needs to read it.
 */
export function RowActionsToggle() {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      data-row-actions-toggle=""
      aria-expanded={false}
      aria-label={t("ui.panels.libraryToolbar.rowActions")}
      title={t("ui.panels.libraryToolbar.rowActions")}
      // Keep the tap from starting a row drag or opening the row.
      onTouchStart={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation();
        const button = event.currentTarget;
        const row = button.closest("[data-receipt-row], [data-receipt-folder]");
        if (!row) return;
        const open = !row.hasAttribute("data-actions-open");
        document.querySelectorAll("[data-actions-open]").forEach((other) => {
          other.removeAttribute("data-actions-open");
          other.querySelector("[data-row-actions-toggle]")?.setAttribute("aria-expanded", "false");
        });
        if (!open) return;
        row.setAttribute("data-actions-open", "");
        button.setAttribute("aria-expanded", "true");
      }}
      className="mari-library-row-more"
    >
      <MoreHorizontal size="1rem" strokeWidth={1.75} />
    </button>
  );
}
