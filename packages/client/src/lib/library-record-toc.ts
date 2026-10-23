type TocChat = { id: string; name: string; createdAt: string; metadata?: Record<string, unknown> | null };
export type RecordTocRow<T extends TocChat> = {
  chat: T;
  /** 0 for a record, 1+ for branches made from it (and branches of branches). */
  depth: number;
  /** Chapter number of a record; branches are numbered within their parent. */
  number: number;
  /** A branch that kept its parent's name shows its branch name or number instead. */
  label: string | null;
};

const DEFAULT_BRANCH_NAME = "New Branch";
const MAX_DEPTH = 8;

/**
 * Reading records as a book's table of contents: records in the order they were started, each followed by the
 * branches made from it (`branchParentChatId`), indented. A branch whose parent is not in this work is a record.
 */
export function buildRecordToc<T extends TocChat>(chats: T[]): RecordTocRow<T>[] {
  const ids = new Set(chats.map((chat) => chat.id));
  const parentOf = (chat: T) => {
    const parent = chat.metadata?.branchParentChatId;
    return typeof parent === "string" && parent !== chat.id && ids.has(parent) ? parent : null;
  };
  const byStart = (a: T, b: T) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  const children = new Map<string, T[]>();
  const roots: T[] = [];
  for (const chat of chats) {
    const parent = parentOf(chat);
    if (parent) children.set(parent, [...(children.get(parent) ?? []), chat]);
    else roots.push(chat);
  }
  const rows: RecordTocRow<T>[] = [];
  const seen = new Set<string>();
  const visit = (chat: T, depth: number, number: number, parent: T | null) => {
    if (seen.has(chat.id)) return;
    seen.add(chat.id);
    const branchName = typeof chat.metadata?.branchName === "string" ? chat.metadata.branchName.trim() : "";
    const label =
      parent && chat.name === parent.name
        ? branchName && branchName !== DEFAULT_BRANCH_NAME
          ? branchName
          : null
        : chat.name;
    rows.push({ chat, depth, number, label });
    if (depth >= MAX_DEPTH) return;
    (children.get(chat.id) ?? []).sort(byStart).forEach((child, index) => visit(child, depth + 1, index + 1, chat));
  };
  roots.sort(byStart).forEach((chat, index) => visit(chat, 0, index + 1, null));
  // A parent cycle leaves chats unvisited; they are still listed as records rather than hidden.
  for (const chat of [...chats].sort(byStart))
    if (!seen.has(chat.id)) visit(chat, 0, rows.filter((row) => !row.depth).length + 1, null);
  return rows;
}
