import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import type { NaiQueueStatus } from "@marinara-engine/shared";
import { api } from "../../../lib/api-client";
const queueKey = ["nai-request-guard"];
export function NaiQueueSettings() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [watching, setWatching] = useState(false);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const [visible, setVisible] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting));
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const query = useQuery({
    queryKey: [...queueKey, offset],
    queryFn: () => api.get<NaiQueueStatus>(`/nai-request-guard/?offset=${offset}`),
    enabled: (open && visible) || watching,
    refetchInterval: watching ? 2000 : open && visible ? 5000 : false,
  });
  const action = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      api.post<NaiQueueStatus>(`/nai-request-guard/${path}`, body),
    onSuccess: (result) => {
      setWatching(result.hasRunning);
      setOffset(0);
      qc.setQueryData([...queueKey, 0], result);
      setSelected([]);
      void qc.invalidateQueries({ queryKey: queueKey });
    },
  });
  const convert = useMutation({
    mutationFn: () =>
      api.post<{ converted: number; failed: number }>(
        "/nai-request-guard/convert-pngs",
        {},
        { signal: AbortSignal.timeout(600000) },
      ),
    onSuccess: (result) => setNotice(t("naiQueue.converted", result)),
  });
  const jobs = query.data?.jobs ?? [];
  const seenAppliedRevision = useRef(0);
  useEffect(() => {
    if (!query.data) return;
    // Keep watching jobs initiated here after navigating back to the original
    // chat/profile, so their completed writes refresh visible query caches.
    setWatching(query.data.hasRunning);
    if (query.data.appliedRevision !== seenAppliedRevision.current) {
      seenAppliedRevision.current = query.data.appliedRevision;
      void qc.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "nai-request-guard" });
    }
  }, [query.data, qc]);
  const pending = action.isPending;
  const items = (ids: string[]) => jobs.filter((j) => ids.includes(j.id)).map(({ id, revision }) => ({ id, revision }));
  const run = (ids: string[]) => action.mutate({ path: "run", body: { items: items(ids) } });
  const cancel = (ids: string[]) => {
    if (window.confirm(t("naiQueue.cancelConfirm"))) action.mutate({ path: "cancel", body: { items: items(ids) } });
  };
  const selectedHeld = jobs.filter((job) => selected.includes(job.id) && job.state === "HELD");
  const button = "rounded-lg border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-40";
  return (
    <div ref={root} className="flex flex-col gap-3">
      <button type="button" className={button} onClick={() => setOpen(!open)} aria-expanded={open}>
        {t("naiQueue.title")}
      </button>
      {open && (
        <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] p-3">
          <p className="text-sm text-[var(--muted-foreground)]">{t("naiQueue.description")}</p>
          <p className="text-sm text-[var(--muted-foreground)]">{t("naiQueue.resultsHelp")}</p>
          {(query.error || action.error || convert.error) && (
            <p role="alert" className="text-sm text-[var(--destructive)]">
              {(query.error ?? action.error ?? convert.error)?.message}
            </p>
          )}
          {query.data?.storageFailed && <p role="alert">{t("naiQueue.storageFailed")}</p>}
          <button type="button" className={button} disabled={query.isFetching} onClick={() => void query.refetch()}>
            {t("naiQueue.refresh")}
          </button>
          {query.data?.groups.map((group) => (
            <div key={group.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] pb-2">
              <span className="text-sm">
                {group.id.slice(0, 8)} · {t(group.automatic ? "naiQueue.auto" : "naiQueue.held")}
              </span>
              {group.notBefore > Date.now() && (
                <span className="text-sm">
                  {t("naiQueue.retryAt", { time: new Date(group.notBefore).toLocaleTimeString() })}
                </span>
              )}
              <button
                type="button"
                className={button}
                disabled={pending}
                onClick={() => action.mutate({ path: "hold", body: { groupId: group.id } })}
              >
                {t("naiQueue.hold")}
              </button>
              {!group.automatic && (
                <button
                  type="button"
                  className={button}
                  disabled={pending || group.notBefore > Date.now()}
                  onClick={() => action.mutate({ path: "automatic", body: { groupId: group.id } })}
                >
                  {t("naiQueue.futureAuto")}
                </button>
              )}
            </div>
          ))}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={button}
              disabled={pending || !selectedHeld.length}
              onClick={() => run(selectedHeld.map((j) => j.id))}
            >
              {t("naiQueue.runSelected")}
            </button>
            <button
              type="button"
              className={button}
              disabled={pending || !query.data?.hasHeld}
              onClick={() => action.mutate({ path: "run", body: { all: true } })}
            >
              {t("naiQueue.runAll")}
            </button>
            <button
              type="button"
              className={button}
              disabled={pending || !selected.length}
              onClick={() => cancel(selected)}
            >
              {t("naiQueue.cancelSelected")}
            </button>
          </div>
          {!jobs.length && <p className="text-sm">{t("naiQueue.empty")}</p>}
          <div className="max-h-96 overflow-y-auto">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] py-3">
                <input
                  type="checkbox"
                  aria-label={t("naiQueue.selectJob", { id: job.id.slice(0, 8) })}
                  disabled={!["HELD", "QUEUED"].includes(job.state)}
                  checked={selected.includes(job.id)}
                  onChange={(event) =>
                    setSelected((ids) => (event.target.checked ? [...ids, job.id] : ids.filter((id) => id !== job.id)))
                  }
                />
                <div className="min-w-0 flex-1 text-sm">
                  <p className="break-words">
                    {job.model} · {job.id.slice(0, 8)}
                  </p>
                  <p>{t(`naiQueue.states.${job.state.toLowerCase()}`)}</p>
                  {job.reason && <p>{t(`naiQueue.reasons.${job.reason}`, { defaultValue: job.reason })}</p>}
                </div>
                {job.state === "HELD" && (
                  <button
                    type="button"
                    className={button}
                    disabled={
                      pending ||
                      !job.connectionId ||
                      (query.data?.groups.find((g) => g.id === job.groupId)?.notBefore ?? 0) > Date.now()
                    }
                    onClick={() => run([job.id])}
                  >
                    {t("naiQueue.runOne")}
                  </button>
                )}
                {["HELD", "QUEUED"].includes(job.state) && (
                  <button type="button" className={button} disabled={pending} onClick={() => cancel([job.id])}>
                    {t("naiQueue.cancel")}
                  </button>
                )}
                {job.state === "APPLY_FAILED" && job.reason === "conversion_failed" && (
                  <button
                    type="button"
                    className={button}
                    disabled={pending}
                    onClick={() => action.mutate({ path: "retry-conversion", body: { items: items([job.id]) } })}
                  >
                    {t("naiQueue.retryConversion")}
                  </button>
                )}
                {["APPLY_FAILED", "CONFLICT"].includes(job.state) && job.reason !== "conversion_failed" && (
                  <button
                    type="button"
                    className={button}
                    disabled={pending}
                    onClick={() => action.mutate({ path: "retry-application", body: { items: items([job.id]) } })}
                  >
                    {t("naiQueue.retryApplication")}
                  </button>
                )}
                {job.resultUrl && (
                  <button
                    type="button"
                    className={button}
                    onClick={() =>
                      void api.download(job.resultUrl!.replace(/^\/api/, ""), job.resultPath ?? `${job.id}.webp`)
                    }
                  >
                    {t("naiQueue.download")}
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className={button}
              disabled={offset === 0}
              onClick={() => {
                setSelected([]);
                setOffset(Math.max(0, offset - 100));
              }}
            >
              {t("naiQueue.previous")}
            </button>
            <button
              type="button"
              className={button}
              disabled={query.data?.nextOffset == null}
              onClick={() => {
                setSelected([]);
                setOffset(query.data!.nextOffset!);
              }}
            >
              {t("naiQueue.next")}
            </button>
          </div>
          <button type="button" className={button} disabled={convert.isPending} onClick={() => convert.mutate()}>
            {t(convert.isPending ? "naiQueue.converting" : "naiQueue.convert")}
          </button>
          <p className="text-sm text-[var(--muted-foreground)]">{t("naiQueue.convertHelp")}</p>
          {notice && (
            <p role="status" className="text-sm">
              {notice}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
