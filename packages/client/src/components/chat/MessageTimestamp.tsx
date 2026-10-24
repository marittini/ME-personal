import { useUIStore } from "../../stores/ui.store";
import { readerTimestampStyle, type ReaderMode } from "../../lib/reader-preferences";

let timeFormatter: Intl.DateTimeFormat | null = null;
let shortTimeFormatter: Intl.DateTimeFormat | null = null;

/** The time alone: RP uses two-digit hours (as before), Convo the locale's short time. */
function timeOnly(date: Date, mode: ReaderMode) {
  if (mode === "roleplay") {
    timeFormatter ??= new Intl.DateTimeFormat([], { hour: "2-digit", minute: "2-digit" });
    return timeFormatter.format(date);
  }
  shortTimeFormatter ??= new Intl.DateTimeFormat([], { hour: "numeric", minute: "2-digit" });
  return shortTimeFormatter.format(date);
}

/** Convo's day-relative label ("Today at …", "Yesterday at …", else the date). */
function dayAndTime(date: Date, mode: ReaderMode) {
  const time = timeOnly(date, mode);
  const now = new Date();
  const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (mode === "conversation") {
    if (sameDay(date, now)) return `Today at ${time}`;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (sameDay(date, yesterday)) return `Yesterday at ${time}`;
  }
  return `${date.toLocaleDateString()} ${time}`;
}

export function formatMessageTimestamp(createdAt: string, mode: ReaderMode, style: "datetime" | "time") {
  const date = new Date(createdAt);
  if (Number.isNaN(date.getTime())) return "";
  return style === "time" ? timeOnly(date, mode) : dayAndTime(date, mode);
}

/** A message's time as the reading settings ask: date and time, the time only, or nothing. */
export function MessageTimestamp({
  createdAt,
  mode,
  className,
}: {
  createdAt: string;
  mode: ReaderMode;
  className?: string;
}) {
  const style = useUIStore((state) => readerTimestampStyle(state.readerPreferences?.[mode]?.timestamp, mode));
  if (style === "hidden") return null;
  return (
    <span className={className} data-message-timestamp={style}>
      {formatMessageTimestamp(createdAt, mode, style)}
    </span>
  );
}
