import { lazy, Suspense, useState, type ComponentProps } from "react";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DialogueSpeechControls } from "./DialogueSpeechControls";
const Paragraphs = lazy(() =>
  import("./ParagraphTranslationPanel").then((module) => ({ default: module.ParagraphTranslationPanel })),
);
export function MessageIntegrationTools(
  props: ComponentProps<typeof DialogueSpeechControls> & { swipeIndex?: number; translation?: string },
) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <DialogueSpeechControls {...props} />
      <details
        className="my-1 text-[var(--muted-foreground)]"
        open={open}
        onToggle={(e) => setOpen(e.currentTarget.open)}
        onClick={(e) => e.stopPropagation()}
      >
        <summary
          className="flex min-h-11 w-fit cursor-pointer items-center gap-2 rounded-md px-2 text-xs"
          aria-label={t("integrations.paragraphTranslation")}
        >
          <Languages size={16} />
          {t("integrations.paragraphTranslation")}
        </summary>
        {open && (
          <Suspense fallback={<p role="status">{t("integrations.loading")}</p>}>
            <Paragraphs
              chatId={props.chatId}
              messageId={props.messageId}
              text={props.text}
              swipeIndex={props.swipeIndex}
              translation={props.translation}
            />
          </Suspense>
        )}
      </details>
    </>
  );
}
