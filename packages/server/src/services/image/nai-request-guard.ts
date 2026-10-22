import { toStoredWebp } from "./webp-storage.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, createHmac, randomInt, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, linkSync } from "node:fs";
import { join } from "node:path";
import type { ImageGenRequest, ImageGenResult } from "@marinara-engine/shared";
import { deriveServerKey } from "../../utils/crypto.js";
import { logger } from "../../lib/logger.js";

type State =
  | "QUEUED"
  | "HELD"
  | "RUNNING"
  | "APPLYING"
  | "CONFLICT"
  | "SUCCEEDED"
  | "APPLY_FAILED"
  | "FAILED"
  | "UNKNOWN"
  | "CANCELLED";
export interface NaiJob {
  id: string;
  groupId: string;
  connectionId: string | null;
  revision: number;
  createdAt: string;
  state: State;
  source: string;
  baseUrl: string;
  serviceHint: string;
  request: ImageGenRequest;
  attempt: number;
  reason?: string;
  resultPath?: string;
  appliedAt?: string;
}
interface Group {
  id: string;
  automatic: boolean;
  notBefore: number;
  reason?: string;
}
interface Snapshot {
  version: 1;
  jobs: NaiJob[];
  groups: Group[];
}
interface Waiter {
  resolve(result: ImageGenResult): void;
  reject(error: Error): void;
}
export class NaiGuardError extends Error {
  constructor(
    public readonly jobId: string,
    public readonly code = "NAI_HELD",
  ) {
    super(`${code}: ${jobId}. Open Settings → NAI image queue.`);
    this.name = "NaiGuardError";
  }
}
export class NaiRateLimitError extends Error {
  constructor(public readonly retryAfter: string | null) {
    super("NovelAI returned HTTP 429");
    this.name = "NaiRateLimitError";
  }
}
export class NaiOutputConversionError extends Error {
  #result: ImageGenResult;
  constructor(result: ImageGenResult) {
    super("Generated image retained because WebP conversion failed");
    this.#result = result;
  }
  get result() {
    return this.#result;
  }
}
export class NaiRequestGuard {
  private data: Snapshot = { version: 1, jobs: [], groups: [] };
  private current = new AsyncLocalStorage<NaiJob>();
  private waiters = new Map<string, Waiter>();
  private submittedKeys = new Map<string, string>();
  private live = new Map<string, (signal: AbortSignal) => Promise<ImageGenResult>>();
  private controllers = new Map<string, AbortController>();
  private running = new Set<string>();
  private approved = new Set<string>();
  private nextAt = new Map<string, number>();
  private wake = new Map<string, () => void>();
  private broken = false;
  private closed = false;
  private dispatched = new Set<string>();
  private converting = new Set<string>();
  constructor(
    private readonly options: {
      directory: string;
      identify: (key: string) => string;
      connectionForKey: (key: string) => Promise<string | null>;
      keyForConnection: (id: string) => Promise<string | null>;
      replay: (job: NaiJob, key: string, signal: AbortSignal) => Promise<ImageGenResult>;
      apply?: (job: NaiJob, resultFile: string) => Promise<void>;
      delay?: () => number;
    },
  ) {
    mkdirSync(options.directory, { recursive: true, mode: 0o700 });
    const file = join(options.directory, "queue.json");
    if (!existsSync(file)) return;
    try {
      const data = JSON.parse(readFileSync(file, "utf8")) as Snapshot;
      if (data.version !== 1 || !Array.isArray(data.jobs) || !Array.isArray(data.groups))
        throw new Error("Invalid NAI queue state");
      for (const group of data.groups) {
        // Only interrupted work needs approval after a restart. Pausing an idle
        // account also blocked every newly requested image, including SharedNAI.
        // Explicit manual/rate-limit holds remain unchanged.
        if (data.jobs.some((job) => job.groupId === group.id && ["QUEUED", "RUNNING"].includes(job.state))) {
          group.automatic = false;
          group.reason = "restart";
        } else if (
          group.reason === "restart" &&
          !data.jobs.some((job) => job.groupId === group.id && ["HELD", "UNKNOWN"].includes(job.state))
        ) {
          // Repair idle accounts paused by older versions, without resending
          // any interrupted or uncertain generation.
          group.automatic = true;
          group.reason = undefined;
        }
      }
      for (const job of data.jobs) {
        if (
          !/^[a-f0-9-]{36}$/.test(job.id) ||
          typeof job.request?.prompt !== "string" ||
          !data.groups.some((g) => g.id === job.groupId)
        )
          throw new Error("Invalid NAI job");
        const url = new URL(job.baseUrl);
        if (
          url.protocol !== "https:" ||
          !["image.novelai.net", "api.novelai.net"].includes(url.hostname.replace(/\.$/, ""))
        )
          throw new Error("Invalid job origin");
        if (job.resultPath && !new RegExp(`^${job.id}\\.(webp|png|jpe?g|avif|gif)$`).test(job.resultPath))
          throw new Error("Invalid job result path");
        job.serviceHint = "novelai";
        delete job.request.fallback;
        delete job.request.signal;
        delete job.request.onFallback;
        delete job.request.allowLocalUrls;
        delete job.request.privateImageResultOrigin;
        if (job.state === "RUNNING") {
          // A saved response is never sent to the provider again, even if the process
          // stopped between writing the result and updating queue.json.
          const receiptFile = join(options.directory, `${job.id}.result.json`);
          if (existsSync(receiptFile)) {
            const receipt = JSON.parse(readFileSync(receiptFile, "utf8"));
            if (
              !new RegExp(`^${job.id}\\.(webp|png|jpe?g|avif|gif)$`).test(receipt.path) ||
              !existsSync(join(options.directory, receipt.path))
            )
              throw new Error("Invalid result receipt");
            job.resultPath = receipt.path;
            job.state = receipt.conversionFailed
              ? "APPLY_FAILED"
              : job.request.naiDestination
                ? "APPLYING"
                : "SUCCEEDED";
            job.reason = receipt.conversionFailed ? "conversion_failed" : "restart_result_saved";
            job.revision++;
            continue;
          }
          job.state = "UNKNOWN";
          job.reason = "restart";
          job.revision++;
        } else if (job.state === "QUEUED") {
          job.state = "HELD";
          job.reason = "restart";
          job.revision++;
        }
      }
      this.data = data;
      this.persist();
    } catch (error) {
      this.broken = true;
      logger.error(error, "[nai-guard] Queue unreadable; native image requests held");
    }
  }
  get isWorker() {
    return !!this.current.getStore();
  }
  get unavailable() {
    return this.broken || this.closed;
  }
  private persist() {
    if (this.broken) throw new NaiGuardError("storage-unavailable");
    const file = join(this.options.directory, "queue.json");
    const temp = `${file}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temp, JSON.stringify(this.data), { mode: 0o600, flag: "wx" });
      renameSync(temp, file);
    } catch (error) {
      this.broken = true;
      this.approved.clear();
      for (const group of this.data.groups) group.automatic = false;
      for (const [id] of this.waiters) this.settle(id, new NaiGuardError(id));
      throw error;
    }
  }
  private group(id: string) {
    let group = this.data.groups.find((g) => g.id === id);
    if (!group) {
      group = { id, automatic: true, notBefore: 0 };
      this.data.groups.push(group);
    }
    return group;
  }
  list(offset = 0) {
    const jobs = [...this.data.jobs].sort(
      (a, b) =>
        Number(["SUCCEEDED", "APPLY_FAILED", "CANCELLED", "FAILED", "UNKNOWN"].includes(a.state)) -
          Number(["SUCCEEDED", "APPLY_FAILED", "CANCELLED", "FAILED", "UNKNOWN"].includes(b.state)) ||
        a.createdAt.localeCompare(b.createdAt),
    );
    return {
      storageFailed: this.broken,
      groups: this.data.groups,
      total: jobs.length,
      hasHeld: jobs.some((j) => j.state === "HELD"),
      hasRunning: jobs.some((j) => ["QUEUED", "RUNNING", "APPLYING"].includes(j.state)),
      appliedRevision: jobs.reduce((sum, job) => sum + (job.appliedAt ? job.revision : 0), 0),
      nextOffset: offset + 100 < jobs.length ? offset + 100 : null,
      jobs: jobs.slice(offset, offset + 100).map(({ request, ...job }) => ({
        ...job,
        model: request.model,
        resultUrl: job.resultPath ? `/api/nai-request-guard/jobs/${job.id}/result` : null,
      })),
    };
  }
  detail(id: string) {
    return this.data.jobs.find((j) => j.id === id);
  }
  async submit(args: {
    source: string;
    baseUrl: string;
    serviceHint: string;
    apiKey: string;
    request: ImageGenRequest;
    task: (signal: AbortSignal) => Promise<ImageGenResult>;
  }) {
    if (this.unavailable) throw new NaiGuardError("unavailable");
    const signal = args.request.signal;
    if (signal?.aborted) throw signal.reason;
    const group = this.group(this.options.identify(args.apiKey));
    const connectionId = await this.options.connectionForKey(args.apiKey);
    const {
      signal: _signal,
      fallback: _fallback,
      onFallback: _onFallback,
      admissionMode: _admissionMode,
      ...request
    } = args.request;
    const job: NaiJob = {
      id: randomUUID(),
      groupId: group.id,
      connectionId,
      revision: 1,
      createdAt: new Date().toISOString(),
      state: group.automatic ? "QUEUED" : "HELD",
      source: args.source,
      baseUrl: args.baseUrl,
      serviceHint: args.serviceHint,
      request: JSON.parse(JSON.stringify(request)),
      attempt: 0,
    };
    this.data.jobs.push(job);
    this.persist();
    if (job.state === "HELD") throw new NaiGuardError(job.id);
    this.submittedKeys.set(job.id, args.apiKey);
    this.live.set(job.id, args.task);
    return new Promise<ImageGenResult>((resolve, reject) => {
      const abort = () => {
        const controller = this.controllers.get(job.id);
        if (controller) controller.abort(signal?.reason);
        else this.cancel([{ id: job.id, revision: job.revision }]);
      };
      this.waiters.set(job.id, {
        resolve: (result) => {
          signal?.removeEventListener("abort", abort);
          resolve(result);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      void this.pump(group.id).catch((error) => logger.error(error, "[nai-guard] Worker stopped"));
    });
  }
  private settle(id: string, result: ImageGenResult | Error) {
    const waiter = this.waiters.get(id);
    this.waiters.delete(id);
    this.live.delete(id);
    this.submittedKeys.delete(id);
    if (result instanceof Error) waiter?.reject(result);
    else waiter?.resolve(result);
  }
  hold(id: string, reason = "manual") {
    const group = this.group(id);
    group.automatic = false;
    group.reason = reason;
    for (const job of this.data.jobs.filter((j) => j.groupId === id)) {
      this.approved.delete(job.id);
      if (job.state === "QUEUED") {
        job.state = "HELD";
        job.reason = reason;
        job.revision++;
        this.settle(job.id, new NaiGuardError(job.id));
      }
    }
    this.wake.get(id)?.();
    this.persist();
  }
  markDispatched() {
    const job = this.current.getStore();
    if (job) this.dispatched.add(job.id);
  }
  markDefinitiveFailure() {
    const job = this.current.getStore();
    if (job) this.dispatched.delete(job.id);
  }
  rateLimited(retryAfter: string | null) {
    const job = this.current.getStore();
    if (!job) return;
    const seconds = retryAfter == null ? NaN : Number(retryAfter);
    const until = Number.isFinite(seconds) ? Date.now() + Math.max(0, seconds) * 1000 : Date.parse(retryAfter ?? "");
    this.group(job.groupId).notBefore = Number.isFinite(until) ? Math.max(Date.now(), until) : Date.now();
    this.hold(job.groupId, "rate_limit");
  }
  run(items: Array<{ id: string; revision: number }>) {
    if (this.unavailable) throw new NaiGuardError("unavailable");
    const jobs = items.map((item) => {
      const job = this.detail(item.id);
      if (!job || job.revision !== item.revision || job.state !== "HELD")
        throw new Error("Queue changed; refresh the list");
      if (!job.connectionId) throw new Error("Save this connection before resuming its jobs");
      if (this.group(job.groupId).notBefore > Date.now()) throw new Error("Retry-After has not elapsed");
      return job;
    });
    for (const groupId of new Set(jobs.map((job) => job.groupId))) this.hold(groupId);
    for (const job of jobs) {
      this.approved.add(job.id);
      job.state = "QUEUED";
      job.revision++;
    }
    this.persist();
    for (const id of new Set(jobs.map((job) => job.groupId)))
      void this.pump(id).catch((error) => logger.error(error, "[nai-guard] Worker stopped"));
  }
  runAll() {
    this.run(this.data.jobs.filter((j) => j.state === "HELD").map(({ id, revision }) => ({ id, revision })));
  }
  cancel(items: Array<{ id: string; revision: number }>) {
    for (const item of items) {
      const job = this.detail(item.id);
      if (!job || job.revision !== item.revision || !["QUEUED", "HELD"].includes(job.state)) continue;
      job.state = "CANCELLED";
      job.revision++;
      this.approved.delete(job.id);
      this.settle(job.id, new NaiGuardError(job.id, "NAI_CANCELLED"));
      this.wake.get(job.groupId)?.();
    }
    this.persist();
  }
  automatic(id: string) {
    const group = this.group(id);
    if (group.notBefore > Date.now()) throw new Error("Retry-After has not elapsed");
    group.automatic = true;
    group.reason = undefined;
    this.persist();
  }
  private async pump(id: string) {
    if (this.running.has(id)) return;
    this.running.add(id);
    try {
      while (!this.unavailable) {
        const group = this.group(id);
        const job = this.data.jobs.find(
          (j) => j.groupId === id && j.state === "QUEUED" && (group.automatic || this.approved.has(j.id)),
        );
        if (!job) break;
        const delay = Math.max(0, (this.nextAt.get(id) ?? 0) - performance.now(), group.notBefore - Date.now());
        if (delay > 0) {
          await new Promise<void>((resolve) => {
            const done = () => {
              clearTimeout(timer);
              this.wake.delete(id);
              resolve();
            };
            const timer = setTimeout(done, delay);
            this.wake.set(id, done);
          });
          continue;
        }
        if (job.connectionId) {
          const currentKey = await this.options.keyForConnection(job.connectionId);
          if (
            !currentKey ||
            this.options.identify(currentKey) !== id ||
            (this.live.has(job.id) && this.submittedKeys.get(job.id) !== currentKey)
          ) {
            job.state = "HELD";
            job.reason = "connection_changed";
            job.revision++;
            this.approved.delete(job.id);
            this.settle(job.id, new NaiGuardError(job.id));
            this.persist();
            continue;
          }
        }
        let task = this.live.get(job.id);
        if (!task) {
          const key = job.connectionId ? await this.options.keyForConnection(job.connectionId) : null;
          if (!key || this.options.identify(key) !== id) {
            job.state = "HELD";
            job.reason = "connection_changed";
            job.revision++;
            this.approved.delete(job.id);
            this.persist();
            continue;
          }
          task = (signal) => this.options.replay(job, key, signal);
        }
        if (job.state !== "QUEUED" || (!group.automatic && !this.approved.has(job.id))) continue;
        job.state = "RUNNING";
        job.attempt++;
        job.revision++;
        this.persist();
        const controller = new AbortController();
        this.controllers.set(job.id, controller);
        try {
          const result = await this.current.run(job, () => task!(controller.signal));
          const resultPath = `${job.id}.${result.ext}`;
          const bytes = Buffer.from(result.base64, "base64");
          const target = join(this.options.directory, resultPath);
          const temp = `${target}.tmp`;
          writeFileSync(temp, bytes, { mode: 0o600 });
          renameSync(temp, target);
          retainedResults.set(createHash("sha256").update(bytes).digest("hex"), target);
          if (retainedResults.size > 200) retainedResults.delete(retainedResults.keys().next().value!);
          writeFileSync(`${target}.receipt.tmp`, JSON.stringify({ path: resultPath, conversionFailed: false }), {
            mode: 0o600,
          });
          renameSync(`${target}.receipt.tmp`, join(this.options.directory, `${job.id}.result.json`));
          job.resultPath = resultPath;
          job.state = !this.live.has(job.id) && job.request.naiDestination ? "APPLYING" : "SUCCEEDED";
          job.reason = undefined;
          job.revision++;
          this.persist();
          if (job.state === "APPLYING") await this.applySaved(job);
          this.settle(job.id, result);
        } catch (error) {
          if (error instanceof NaiOutputConversionError) {
            const path = `${job.id}.${error.result.ext}`;
            const target = join(this.options.directory, path);
            writeFileSync(`${target}.tmp`, Buffer.from(error.result.base64, "base64"), { mode: 0o600 });
            renameSync(`${target}.tmp`, target);
            writeFileSync(`${target}.receipt.tmp`, JSON.stringify({ path, conversionFailed: true }), { mode: 0o600 });
            renameSync(`${target}.receipt.tmp`, join(this.options.directory, `${job.id}.result.json`));
            job.resultPath = path;
            job.state = "APPLY_FAILED";
            job.reason = "conversion_failed";
            this.settle(job.id, new NaiGuardError(job.id, "NAI_RESULT_SAVED"));
          } else if (error instanceof NaiRateLimitError) {
            job.state = "HELD";
            job.reason = "rate_limit";
            this.settle(job.id, new NaiGuardError(job.id));
          } else if (job.resultPath) {
            // A local write/application failure after receipt cannot turn a saved
            // generation into UNKNOWN or allow another paid provider request.
            job.state = "APPLY_FAILED";
            job.reason = "application_failed";
            this.settle(job.id, new NaiGuardError(job.id, "NAI_RESULT_SAVED"));
          } else {
            job.state =
              this.dispatched.has(job.id) ||
              controller.signal.aborted ||
              (error instanceof Error && ["AbortError", "TimeoutError", "TypeError"].includes(error.name))
                ? "UNKNOWN"
                : "FAILED";
            job.reason = job.state === "UNKNOWN" ? "unknown_result" : "generation_failed";
            this.settle(
              job.id,
              job.state === "UNKNOWN"
                ? new NaiGuardError(job.id, "NAI_UNKNOWN")
                : error instanceof Error
                  ? error
                  : new Error("Image generation failed"),
            );
          }
          job.revision++;
          this.persist();
        } finally {
          this.dispatched.delete(job.id);
          this.controllers.delete(job.id);
          this.approved.delete(job.id);
          this.nextAt.set(id, performance.now() + (this.options.delay?.() ?? randomInt(2000, 5001)));
        }
      }
    } catch (error) {
      this.broken = true;
      for (const group of this.data.groups) group.automatic = false;
      this.approved.clear();
      for (const [jobId] of this.waiters) this.settle(jobId, new NaiGuardError(jobId, "NAI_STORAGE_FAILED"));
      throw error;
    } finally {
      this.running.delete(id);
    }
  }
  async retryConversion(id: string, revision: number) {
    const job = this.detail(id);
    if (
      !job ||
      job.revision !== revision ||
      job.state !== "APPLY_FAILED" ||
      job.reason !== "conversion_failed" ||
      !job.resultPath ||
      this.converting.has(id)
    )
      throw new Error("Queue changed; refresh the list");
    this.converting.add(id);
    try {
      const image = await toStoredWebp(readFileSync(join(this.options.directory, job.resultPath)));
      if (image.ext !== "webp") throw new Error("This image cannot be converted without losing animation");
      const path = `${job.id}.webp`;
      const target = join(this.options.directory, path);
      writeFileSync(`${target}.tmp`, image.buffer, { mode: 0o600 });
      renameSync(`${target}.tmp`, target);
      job.resultPath = path;
      job.state = job.request.naiDestination ? "APPLYING" : "SUCCEEDED";
      job.reason = undefined;
      job.revision++;
      this.persist();
      if (job.state === "APPLYING") await this.applySaved(job);
    } finally {
      this.converting.delete(id);
    }
  }
  private async applySaved(job: NaiJob) {
    if (!job.resultPath || !job.request.naiDestination) return;
    try {
      if (!this.options.apply) throw new Error("Application adapter unavailable");
      await this.options.apply(job, join(this.options.directory, job.resultPath));
      job.state = "SUCCEEDED";
      job.appliedAt = new Date().toISOString();
      job.reason = "applied";
    } catch (error) {
      job.state = error instanceof Error && error.message === "NAI_DESTINATION_CONFLICT" ? "CONFLICT" : "APPLY_FAILED";
      job.reason = job.state === "CONFLICT" ? "destination_changed" : "application_failed";
      logger.warn({ jobId: job.id, reason: job.reason }, "[nai-guard] Saved image could not be applied");
    }
    job.revision++;
    this.persist();
  }
  /** Recovery performs local writes only. It never starts generation. */
  async recoverApplications() {
    for (const job of this.data.jobs.filter((job) => job.state === "APPLYING")) {
      if (this.closed) break;
      if (this.converting.has(job.id)) continue;
      this.converting.add(job.id);
      try {
        await this.applySaved(job);
      } finally {
        this.converting.delete(job.id);
      }
    }
  }
  async retryApplication(id: string, revision: number) {
    const job = this.detail(id);
    if (
      !job ||
      job.revision !== revision ||
      !["APPLY_FAILED", "CONFLICT"].includes(job.state) ||
      job.reason === "conversion_failed" ||
      !job.resultPath ||
      !job.request.naiDestination ||
      this.converting.has(id)
    )
      throw new Error("Queue changed; refresh the list");
    this.converting.add(id);
    try {
      job.state = "APPLYING";
      job.revision++;
      this.persist();
      await this.applySaved(job);
    } finally {
      this.converting.delete(id);
    }
  }
  close() {
    this.closed = true;
    for (const done of this.wake.values()) done();
    for (const controller of this.controllers.values()) controller.abort();
    for (const [id] of this.waiters) this.settle(id, new NaiGuardError(id));
  }
}
const retainedResults = new Map<string, string>();
export function linkRetainedNaiResult(bytes: Buffer, target: string) {
  const source = retainedResults.get(createHash("sha256").update(bytes).digest("hex"));
  if (!source) return false;
  try {
    linkSync(source, target);
    return true;
  } catch {
    return false;
  }
}
let guard: NaiRequestGuard | undefined;
export function getNaiRequestGuard() {
  return guard;
}
export function setNaiRequestGuard(value: NaiRequestGuard | undefined) {
  guard = value;
}
export function naiAccountGroup(key: string) {
  const username = /^sharednai:([^:]+):/.exec(key)?.[1];
  const identity = username
    ? `sharednai-user:${username}`
    : key.startsWith("sharednai-token:")
      ? key
      : `novelai:${key.trim()}`;
  return createHmac("sha256", deriveServerKey("nai-request-guard")).update(identity).digest("hex");
}
