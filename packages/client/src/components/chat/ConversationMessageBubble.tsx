// ──────────────────────────────────────────────
// Bubble message layout (Messenger-style)
// ──────────────────────────────────────────────
import { User } from "lucide-react";
import { MessageTimestamp } from "./MessageTimestamp";
import { normalizeTextForMatch, splitGroupedSegmentDisplayLines } from "@marinara-engine/shared";
import { cn } from "../../lib/utils";
import { PendingTypingDots } from "./PendingTypingDots";
import {
  MESSAGE_SELECTION_CHECKBOX_CLASS,
  MESSAGE_SELECTION_CHECKBOX_SELECTED_CLASS,
} from "./message-selection-styles";
import {
  HiddenFromAIConversationSummary,
  DiceMessageContent,
  MessageContent,
  ConversationParagraphs,
  conversationTranslationPlan,
  ConversationMessageEditForm,
  ConversationMessageAttachments,
  ConversationMessageTranslation,
  ConversationMessageName,
  diceRollReplacesMessageContent,
  nameColorStyle,
  type MessageRenderContext,
} from "./ConversationMessageShared";
import { useTranslation as useUiTranslation } from "react-i18next";

export function ConversationMessageBubble({ ctx }: { ctx: MessageRenderContext }) {
  const { t: localizeUi } = useUiTranslation();
  const {
    message,
    extra,
    isUser,
    isGrouped,
    displayName,
    avatarUrl,
    avatarCropStyle,
    avatarCornerClass,
    nameColor,
    mentionNames,
    quoteFormat,
    charByName,
    charIdByName,
    selfCharacterId,
    galleryIndex,
    groupedSegments,
    visibleSegments,
    renderedContent,
    emojiMap,
    stickerMap,
    streamingBubbleDraftContent,
    isStreaming,
    editing,
    editValue,
    editRef,
    onEditValueChange,
    onSaveEdit,
    onCancelEdit,
    isHiddenCollapsed,
    hiddenFromAIHeader,
    onExpandHidden,
    hideTimestamp,
    showActions,
    forceShowActions,
    showMessageNumbers,
    messageIndex,
    onImageOpen,
    onRemoveAttachment,
    translatedText,
    isTranslating,
    multiSelectMode,
    isSelected,
    onToggleSelect,
    messageTextStyle,
    bubbleCornerClass,
    shouldHideUserAvatar,
  } = ctx;

  const paragraphTranslations = conversationTranslationPlan(ctx);
  return (
    <>
      {/* Inner row: avatar + body — swipes live outside so avatar never drifts */}
      <div className={cn("flex w-full min-w-0 max-w-full items-start gap-2", isUser ? "justify-end" : "justify-start")}>
        {/* Multi-select checkbox */}
        {multiSelectMode && (
          <div className="flex items-center flex-shrink-0">
            <button
              type="button"
              role="checkbox"
              aria-checked={isSelected}
              aria-label={
                isSelected
                  ? localizeUi("ui.chat.chatmessage.deselectMessage")
                  : localizeUi("ui.chat.chatmessage.selectMessage")
              }
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSelect?.();
              }}
              onKeyDown={(e) => {
                if (e.key === " " || e.key === "Enter") {
                  e.preventDefault();
                  onToggleSelect?.();
                }
              }}
              className={cn(
                MESSAGE_SELECTION_CHECKBOX_CLASS,
                "flex items-center justify-center",
                isSelected && MESSAGE_SELECTION_CHECKBOX_SELECTED_CLASS,
              )}
            >
              {isSelected && <span className="text-xs font-bold text-[var(--marinara-chat-chrome-panel-bg)]">✓</span>}
            </button>
          </div>
        )}

        {/* Avatar column */}
        <div className={cn("mari-message-avatar w-10 flex-shrink-0", shouldHideUserAvatar && "hidden")}>
          {!isGrouped && (
            <>
              {ctx.onOpenAboutMe ? (
                <button
                  type="button"
                  onClick={(e) => ctx.onOpenAboutMe?.(e.currentTarget.getBoundingClientRect())}
                  aria-label={localizeUi("ui.chat.conversationmessagebubble.viewValue1SAboutMe", {
                    value1: displayName,
                  })}
                  title={localizeUi("ui.chat.conversationmessagebubble.viewValue1SAboutMe", { value1: displayName })}
                  className={cn(
                    "relative block h-10 w-10 overflow-hidden bg-[var(--accent)] cursor-pointer transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--primary)]/50",
                    avatarCornerClass,
                  )}
                >
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      style={avatarCropStyle}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                      {isUser ? <User size="1.125rem" /> : displayName[0]?.toUpperCase()}
                    </div>
                  )}
                </button>
              ) : (
                <div className={cn("relative h-10 w-10 overflow-hidden bg-[var(--accent)]", avatarCornerClass)}>
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={displayName}
                      loading="lazy"
                      className="h-full w-full object-cover"
                      style={avatarCropStyle}
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-sm font-bold text-[var(--muted-foreground)]">
                      {isUser ? <User size="1.125rem" /> : displayName[0]?.toUpperCase()}
                    </div>
                  )}
                </div>
              )}
              {(showActions || forceShowActions || showMessageNumbers) && messageIndex != null && (
                <span className="mari-conversation-transcript-chrome-text mt-0.5 block text-center text-[0.5rem] font-medium select-none">
                  #{messageIndex}
                </span>
              )}
            </>
          )}
        </div>

        {/* Body column — header + bubble + attachments (no swipes) */}
        <div
          className={cn(
            "mari-message-body mari-message-body--bubble min-w-0 flex max-w-[72%] flex-initial flex-col",
            isUser ? "items-end" : "items-start",
          )}
        >
          {/* Header — name + timestamp for first in group */}
          {!isGrouped && (!isUser || hiddenFromAIHeader || ctx.speechReplay) && (
            <div
              className={cn(
                "mari-message-meta mb-0.5 flex items-baseline gap-2",
                isUser ? "justify-end pr-2 text-right" : "pl-2",
              )}
            >
              {hiddenFromAIHeader}
              {!isUser && (
                <ConversationMessageName
                  displayName={displayName}
                  nameColor={nameColor}
                  onOpenAboutMe={ctx.onOpenAboutMe}
                />
              )}
              {!hideTimestamp && !isUser && (
                <MessageTimestamp
                  createdAt={message.createdAt}
                  mode="conversation"
                  className="mari-message-timestamp mari-conversation-transcript-chrome-text text-[0.6875rem]"
                />
              )}
              {ctx.speechReplay}
            </div>
          )}

          {/* Bubble */}
          {isHiddenCollapsed ? (
            <HiddenFromAIConversationSummary onExpand={onExpandHidden} />
          ) : editing ? (
            <ConversationMessageEditForm
              editRef={editRef}
              editValue={editValue}
              onValueChange={onEditValueChange}
              onSave={onSaveEdit}
              onCancel={onCancelEdit}
              messageTextStyle={messageTextStyle}
              quoteFormat={quoteFormat}
            />
          ) : groupedSegments && !isUser ? (
            <div className="flex flex-col items-start gap-1.5">
              {groupedSegments.slice(0, visibleSegments).map((grp, i) => {
                const segChar = grp.speaker && charByName ? charByName.get(normalizeTextForMatch(grp.speaker)) : null;
                const segSelfId =
                  (grp.speaker && charIdByName ? charIdByName.get(normalizeTextForMatch(grp.speaker)) : null) ??
                  selfCharacterId;
                const segName = segChar?.convoDisplayName?.trim() || segChar?.name || grp.speaker || "";
                const displayLines = splitGroupedSegmentDisplayLines(grp);
                const translationOffset = groupedSegments.slice(0, i).flatMap(splitGroupedSegmentDisplayLines).length;

                if (!grp.speaker) {
                  if (displayLines.length === 0) return null;
                  return (
                    <div
                      key={`${grp.start}-${i}`}
                      className="mari-message-content mari-chat-style-text py-0.5 text-[0.875rem] leading-relaxed break-words whitespace-pre-wrap text-[var(--muted-foreground)] italic animate-[fadeSlideIn_0.25s_ease-out]"
                      style={messageTextStyle}
                    >
                      <ConversationParagraphs
                        translations={paragraphTranslations?.slice(
                          translationOffset,
                          translationOffset + displayLines.length,
                        )}
                        content={displayLines.join("\n\n")}
                        mentionNames={mentionNames}
                        emojiMap={emojiMap}
                        stickerMap={stickerMap}
                        onImageOpen={(url) => onImageOpen(url)}
                        selfCharacterId={selfCharacterId}
                        galleryIndex={galleryIndex}
                      />
                    </div>
                  );
                }

                return displayLines.map((line, lineIndex) => (
                  <div key={`${grp.start}-${i}-${lineIndex}`} className="flex min-w-0 flex-col items-start">
                    <div
                      className="mari-message-content mari-chat-style-text mari-message-bubble mari-chat-style-conversation texting-bubble texting-bubble-other relative rounded-2xl rounded-tl-md px-3.5 py-2 text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap shadow-sm animate-[fadeSlideIn_0.25s_ease-out]"
                      style={messageTextStyle}
                    >
                      <div
                        className="mb-0.5 text-[0.75rem] font-semibold leading-tight opacity-90"
                        style={nameColorStyle(segChar?.nameColor)}
                      >
                        {segName}
                      </div>
                      <MessageContent
                        content={line}
                        mentionNames={mentionNames}
                        emojiMap={emojiMap}
                        stickerMap={stickerMap}
                        onImageOpen={(url) => onImageOpen(url)}
                        selfCharacterId={segSelfId}
                        galleryIndex={galleryIndex}
                      />
                    </div>
                    {/* A shown translation sits under the bubble, never inside its background. */}
                    <ConversationMessageTranslation
                      translatedText={paragraphTranslations?.[translationOffset + lineIndex]}
                      isTranslating={false}
                      outside
                    />
                  </div>
                ));
              })}
            </div>
          ) : (
            <div
              className={cn(
                "mari-message-content mari-chat-style-text text-[0.9375rem] leading-relaxed break-words whitespace-pre-wrap",
                (isStreaming && !renderedContent) || extra.diceRollResult
                  ? "mari-message-bubble mari-chat-style-conversation texting-bubble relative px-3.5 py-2 shadow-sm"
                  : "w-full",
                ((isStreaming && !renderedContent) || extra.diceRollResult) &&
                  (isUser ? "texting-bubble-user" : "texting-bubble-other"),
                ((isStreaming && !renderedContent) || extra.diceRollResult) && bubbleCornerClass,
                isStreaming && !renderedContent && "py-2.5",
              )}
              style={messageTextStyle}
            >
              {isStreaming && !renderedContent ? (
                /* Typing dots + optional stable preview */
                <div className={cn("space-y-2", streamingBubbleDraftContent && "animate-[fadeSlideIn_0.25s_ease-out]")}>
                  {streamingBubbleDraftContent && (
                    <MessageContent
                      content={streamingBubbleDraftContent}
                      mentionNames={mentionNames}
                      emojiMap={emojiMap}
                      stickerMap={stickerMap}
                      onImageOpen={(url) => onImageOpen(url)}
                      selfCharacterId={selfCharacterId}
                      galleryIndex={galleryIndex}
                    />
                  )}
                  <PendingTypingDots
                    label={localizeUi("ui.chat.conversationmessagebubble.stillTyping")}
                    dotClassName="bg-[var(--muted-foreground)]/60"
                  />
                </div>
              ) : diceRollReplacesMessageContent(message.role, extra.diceRollResult) ? (
                <DiceMessageContent diceRollResult={extra.diceRollResult} createdAt={message.createdAt} />
              ) : (
                <>
                  {extra.diceRollResult ? (
                    <DiceMessageContent diceRollResult={extra.diceRollResult} createdAt={message.createdAt} />
                  ) : null}
                  <ConversationParagraphs
                    translations={paragraphTranslations}
                    bubbleClass={cn(
                      "mari-message-bubble mari-chat-style-conversation texting-bubble relative px-3.5 py-2 shadow-sm",
                      isUser ? "texting-bubble-user" : "texting-bubble-other",
                      bubbleCornerClass,
                    )}
                    content={renderedContent}
                    mentionNames={mentionNames}
                    emojiMap={emojiMap}
                    stickerMap={stickerMap}
                    onImageOpen={(url) => onImageOpen(url)}
                    selfCharacterId={selfCharacterId}
                    galleryIndex={galleryIndex}
                  />
                </>
              )}
            </div>
          )}

          {!isHiddenCollapsed && (
            <>
              <ConversationMessageTranslation
                translatedText={ctx.showTranslationOnly || paragraphTranslations ? null : translatedText}
                isTranslating={isTranslating}
                outside
              />
              <ConversationMessageAttachments
                attachments={extra.attachments ?? []}
                renderedContent={renderedContent}
                onImageOpen={onImageOpen}
                onRemove={onRemoveAttachment}
              />
            </>
          )}
        </div>
      </div>
    </>
  );
}
