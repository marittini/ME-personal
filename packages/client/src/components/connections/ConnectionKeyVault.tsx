import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useKeyVault, useVaultStatus, type VaultEntry } from "../../hooks/use-native-integrations";
import { useConnections } from "../../hooks/use-connections";
import { downloadJsonFile } from "../../lib/download-json";
import { showConfirmDialog } from "../../lib/app-dialogs";
import { INTEGRATION_BUTTON as button, INTEGRATION_INPUT as field } from "../chat/IntegrationControls";

export function ConnectionKeyVault({
  connectionId,
  onSelect,
}: {
  connectionId?: string | null;
  onSelect?: (key: string) => void;
}) {
  const { t } = useTranslation();
  const action = useKeyVault();
  const status = useVaultStatus();
  const connections = useConnections();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [target, setTarget] = useState(connectionId ?? "");
  const [name, setName] = useState("");
  const [group, setGroup] = useState("");
  const [key, setKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const run = async (input: Record<string, unknown>) => {
    try {
      const result = await action.mutateAsync({ ...input, password });
      if (result.entries) setEntries(result.entries);
      return result;
    } catch {
      toast.error(t("integrations.vaultError"));
      return null;
    }
  };
  const lock = () => {
    setOpen(false);
    setPassword("");
    setConfirmation("");
    setKey("");
    setEntries([]);
    setNewPassword("");
    action.reset();
  };
  return (
    <section className="space-y-3 py-4" aria-label={t("integrations.vault")}>
      <p className="text-sm text-[var(--muted-foreground)]">{t("integrations.vaultHelp")}</p>
      {!open ? (
        <>
          <label className="block text-sm">
            {t("integrations.masterPassword")}
            <input
              className={field}
              type="password"
              autoComplete="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {status.data?.exists === false && (
            <label className="block text-sm">
              {t("integrations.confirmPassword")}
              <input
                className={field}
                type="password"
                autoComplete="off"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
              />
            </label>
          )}
          <button
            className={button}
            type="button"
            disabled={
              status.isPending ||
              action.isPending ||
              password.length < 4 ||
              (status.data?.exists === false && confirmation !== password)
            }
            onClick={async () => {
              if (await run({ action: "list" })) {
                setOpen(true);
                setConfirmation("");
              }
            }}
          >
            {t("integrations.unlock")}
          </button>
        </>
      ) : (
        <>
          <button type="button" className={button} onClick={lock}>
            {t("integrations.lock")}
          </button>
          {!onSelect && (
            <label className="block text-sm">
              {t("integrations.connection")}
              <select className={field} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">{t("integrations.selectConnection")}</option>
                {(connections.data as Array<{ id: string; name: string }> | undefined)?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <input
            className={field}
            aria-label={t("integrations.groupFilter")}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          {entries
            .filter((row) => `${row.group} ${row.name}`.toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
            .map((row) => (
              <div key={row.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] py-2">
                <span className="min-w-0 flex-1 break-words text-sm">
                  {row.group} · {row.name}
                </span>
                <button
                  type="button"
                  className={button}
                  disabled={action.isPending || (!onSelect && !target)}
                  onClick={async () => {
                    const result = await run({
                      action: onSelect ? "select" : "apply",
                      id: row.id,
                      connectionId: target,
                    });
                    if (result) {
                      if (result.selectedKey && onSelect) {
                        onSelect(result.selectedKey);
                        action.reset();
                      }
                      toast.success(t(onSelect ? "integrations.appliedDraft" : "integrations.keyApplied"));
                    }
                  }}
                >
                  {t("integrations.apply")}
                </button>
                <button
                  type="button"
                  className={button}
                  onClick={() => {
                    setEditing(row.id);
                    setName(row.name);
                    setGroup(row.group);
                    setKey("");
                  }}
                >
                  {t("integrations.edit")}
                </button>
                <button
                  type="button"
                  className={button}
                  disabled={action.isPending}
                  onClick={async () => {
                    if (
                      await showConfirmDialog({
                        title: t("integrations.remove"),
                        message: row.name,
                        tone: "destructive",
                      })
                    )
                      await run({ action: "remove", id: row.id });
                  }}
                >
                  {t("integrations.remove")}
                </button>
              </div>
            ))}
          <label className="block text-sm">
            {t("integrations.keyName")}
            <input className={field} value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block text-sm">
            {t("integrations.group")}
            <input className={field} value={group} onChange={(e) => setGroup(e.target.value)} />
          </label>
          <label className="block text-sm">
            {t("integrations.secretKey")}
            <input
              className={field}
              autoComplete="off"
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder={editing ? t("integrations.keepKey") : undefined}
            />
          </label>
          <button
            className={button}
            type="button"
            disabled={action.isPending || !name.trim() || (!editing && !key.trim())}
            onClick={async () => {
              if (await run({ action: "save", id: editing ?? undefined, name, group, key })) {
                setName("");
                setKey("");
                setEditing(null);
              }
            }}
          >
            {t("integrations.saveKey")}
          </button>
          <details>
            <summary className="min-h-11 cursor-pointer py-3 text-sm">{t("integrations.vaultManage")}</summary>
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                type="button"
                disabled={action.isPending}
                onClick={async () => {
                  const result = await run({ action: "export" });
                  if (result?.backup) await downloadJsonFile(result.backup, "marinara-key-vault.json");
                }}
              >
                {t("integrations.backup")}
              </button>
              <label className={button}>
                {t("integrations.restore")}
                <input
                  className="hidden"
                  type="file"
                  accept="application/json"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (!file) return;
                    try {
                      await run({
                        action: "import",
                        backup: JSON.parse(await file.text()),
                        newPassword: newPassword || undefined,
                      });
                    } catch {
                      toast.error(t("integrations.importError"));
                    }
                  }}
                />
              </label>
              <label className="block w-full text-sm">
                {t("integrations.newPassword")}
                <input
                  className={field}
                  type="password"
                  autoComplete="off"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <button
                className={button}
                type="button"
                disabled={action.isPending || newPassword.length < 4}
                onClick={async () => {
                  if (await run({ action: "changePassword", newPassword })) {
                    setPassword(newPassword);
                    setNewPassword("");
                  }
                }}
              >
                {t("integrations.changePassword")}
              </button>
              <button
                className={button}
                type="button"
                disabled={action.isPending}
                onClick={async () => {
                  if (
                    await showConfirmDialog({
                      title: t("integrations.resetVault"),
                      message: t("integrations.resetVaultConfirm"),
                      tone: "destructive",
                    })
                  )
                    if (await run({ action: "reset" })) lock();
                }}
              >
                {t("integrations.resetVault")}
              </button>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
