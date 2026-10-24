import { useEffect, useId, useState } from "react";
import { Minus, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";

export function ReaderNumberSetting({
  label,
  unit,
  value,
  min,
  max,
  step = 0.1,
  onChange,
}: {
  label: string;
  unit: string;
  value: number;
  min: number;
  max: number;
  /** Size of one ± press; also the input's step. */
  step?: number;
  onChange: (value: number) => void;
}) {
  const { t } = useTranslation();
  const id = useId();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const normalize = (next: number) => Math.round(Math.max(min, Math.min(max, next)) * 10) / 10;
  const commit = (next: number) => {
    const normalized = normalize(next);
    onChange(normalized);
    setDraft(String(normalized));
  };
  const button =
    "mari-chrome-control inline-flex h-9 w-9 shrink-0 items-center justify-center p-0 disabled:opacity-40";
  // A settings row: the label on the left, − value + on the right.
  return (
    <div className="flex min-h-11 items-center justify-between gap-3 text-sm">
      <label htmlFor={id} className="min-w-0 leading-snug">
        {label} ({unit})
      </label>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          className={button}
          disabled={value <= min}
          aria-label={t("reader.decrease", { label, step })}
          onClick={() => commit(value - step)}
        >
          <Minus size={16} />
        </button>
        <input
          id={id}
          className="mari-chrome-field h-9 w-14 px-1 text-center tabular-nums"
          type="number"
          inputMode="decimal"
          step={step}
          min={min}
          max={max}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            setDraft(text);
            const number = Number(text);
            if (text.trim() && Number.isFinite(number) && number >= min && number <= max) onChange(normalize(number));
          }}
          onBlur={() => commit(draft.trim() && Number.isFinite(Number(draft)) ? Number(draft) : value)}
        />
        <button
          type="button"
          className={button}
          disabled={value >= max}
          aria-label={t("reader.increase", { label, step })}
          onClick={() => commit(value + step)}
        >
          <Plus size={16} />
        </button>
      </div>
    </div>
  );
}
