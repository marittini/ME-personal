import type { APIConnection } from "@marinara-engine/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation, useTranslation as useUiTranslation } from "react-i18next";
import { useConnections } from "../../hooks/use-connections";
import { useGenerateNaiPrompt, useNaiPromptSources } from "../../hooks/use-nai-character-prompt";
import { copyToClipboard } from "../../lib/utils";

export function NaiCharacterPromptTool() {
  const { t: localizeUi } = useUiTranslation();
  const { t } = useTranslation();
  const sources = useNaiPromptSources();
  const connections = useConnections();
  const generate = useGenerateNaiPrompt();
  const [sourceKey, setSourceKey] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const [result, setResult] = useState<{ prompt: string; negative: string } | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const languages = ((connections.data ?? []) as APIConnection[]).filter(
    (connection) => !["image_generation", "video_generation", "audio", "decision"].includes(connection.provider),
  );
  const selected = sources.data?.find((source) => `${source.kind}:${source.id}` === sourceKey);
  const selectedConnection = connectionId || languages.find((connection) => connection.isDefault)?.id || "";
  const field = "mt-2 min-h-11 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-3 text-sm";
  return (
    <div className="space-y-5">
      <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{t("naiPrompt.help")}</p>
      {(sources.isError || connections.isError) && (
        <div role="alert">
          <p>{t("naiPrompt.loadError")}</p>
          <button
            type="button"
            className={field}
            onClick={() => {
              void sources.refetch();
              void connections.refetch();
            }}
          >
            {t("libraryShell.retry")}
          </button>
        </div>
      )}
      <label className="block text-sm">
        {t("naiPrompt.source")}
        <select
          className={field}
          value={sourceKey}
          disabled={generate.isPending}
          onChange={(event) => {
            setSourceKey(event.target.value);
            setResult(null);
          }}
        >
          <option value="">{t("naiPrompt.chooseSource")}</option>
          {sources.data?.map((source) => (
            <option key={`${source.kind}:${source.id}`} value={`${source.kind}:${source.id}`}>
              {t(`naiPrompt.${source.kind}`)} · {source.name}
              {source.comment ? localizeUi("ui.connections.connectioneditor.value1", { value1: source.comment }) : ""}
            </option>
          ))}
        </select>
      </label>
      <label className="block text-sm">
        {t("naiPrompt.connection")}
        <select
          className={field}
          value={selectedConnection}
          disabled={generate.isPending}
          onChange={(event) => setConnectionId(event.target.value)}
        >
          <option value="">{t("naiPrompt.chooseConnection")}</option>
          {languages.map((connection) => (
            <option key={connection.id} value={connection.id}>
              {connection.name}
            </option>
          ))}
        </select>
      </label>
      <button
        type="button"
        className={field}
        disabled={!selected || !selectedConnection || generate.isPending}
        onClick={async () => {
          if (!selected) return;
          const next = new AbortController();
          controller.current = next;
          try {
            const output = await generate.mutateAsync({
              id: selected.id,
              kind: selected.kind,
              connectionId: selectedConnection,
              signal: next.signal,
            });
            if (!next.signal.aborted) setResult(output);
          } catch {
            /* Mutation state exposes failure; abort remains silent. */
          }
        }}
      >
        {generate.isPending ? t("naiPrompt.generating") : t("naiPrompt.generate")}
      </button>
      {generate.isPending && (
        <button type="button" className={field} onClick={() => controller.current?.abort()}>
          {t("reader.cancel")}
        </button>
      )}
      {generate.isError && !controller.current?.signal.aborted && (
        <p role="alert" className="text-sm text-[var(--destructive)]">
          {t("naiPrompt.generateError")}
        </p>
      )}
      {result &&
        (["prompt", "negative"] as const).map((kind) => (
          <div key={kind}>
            <label className="block text-sm">
              {t(`naiPrompt.${kind}`)}
              <textarea readOnly value={result[kind]} rows={6} className={`${field} py-3`} />
            </label>
            <button type="button" className={field} onClick={() => void copyToClipboard(result[kind])}>
              {t("naiPrompt.copy")}
            </button>
          </div>
        ))}
    </div>
  );
}
