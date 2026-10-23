import { useState, type ReactNode } from "react";
import { Crop, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AvatarCrop, SourceRectAvatarCrop } from "@marinara-engine/shared";
import { getAvatarCropStyle, isLegacyAvatarCrop } from "../../lib/utils";
import { AvatarCropWidget } from "./AvatarCropWidget";
import { Modal } from "./Modal";

/**
 * The saved square avatar crop widened to a 3:4 portrait around the same center, within the source image.
 * Returns null when there is no current-format crop (the picture is then shown as a cover from the top).
 */
export function portraitCropRect(crop: AvatarCrop | null): SourceRectAvatarCrop | null {
  if (!crop || isLegacyAvatarCrop(crop)) return null;
  let { srcX, srcY, srcWidth, srcHeight } = crop;
  if (srcWidth <= 0 || srcHeight <= 0) return null;
  // A square crop in source pixels is srcWidth·W = srcHeight·H; 4:3 taller keeps the same source width.
  let height = (srcHeight * 4) / 3;
  if (height > 1) {
    // Too tall for the image: keep the full height and narrow the width to stay 3:4.
    srcWidth = srcWidth / height;
    srcX = srcX + (crop.srcWidth - srcWidth) / 2;
    height = 1;
  }
  const centerY = srcY + srcHeight / 2;
  srcY = Math.min(Math.max(centerY - height / 2, 0), 1 - height);
  srcHeight = height;
  srcX = Math.min(Math.max(srcX, 0), 1 - srcWidth);
  return { srcX, srcY, srcWidth, srcHeight };
}

/**
 * The photo cell of a character/persona info sheet: a fixed 3:4 cell showing only the cropped result, so a wide or
 * square original never spills out of it. "아바타 자르기" opens the crop tool in its own window.
 */
export function ProfileSheetPortrait({
  src,
  alt,
  crop,
  onCropChange,
  onRemove,
  removing,
  disabled = false,
  label,
  children,
}: {
  src: string | null;
  alt: string;
  crop: AvatarCrop | null;
  onCropChange: (next: SourceRectAvatarCrop) => void;
  onRemove?: () => void;
  removing?: boolean;
  /** While the record is saving or uploading, cropping is locked (the crop tool is disabled too). */
  disabled?: boolean;
  label: ReactNode;
  /** Upload / generate actions. */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const [cropping, setCropping] = useState(false);
  const rect = portraitCropRect(crop);
  return (
    <div className="mari-sheet__portrait" data-sheet-portrait="">
      <span className="mari-sheet__label">{label}</span>
      <div className="mari-sheet__photo" data-sheet-photo="">
        {src ? (
          <img
            src={src}
            alt={alt}
            draggable={false}
            className={rect ? undefined : "h-full w-full object-cover object-top"}
            style={rect ? getAvatarCropStyle(rect) : undefined}
          />
        ) : (
          <UserRound className="mari-sheet__photo-empty" aria-hidden="true" />
        )}
      </div>
      <div className="mari-sheet__photo-actions">
        {src && (
          <button
            type="button"
            className="mari-editor-action inline-flex h-9 px-2.5 text-xs disabled:opacity-50"
            disabled={disabled}
            onClick={() => setCropping(true)}
          >
            <Crop size="0.875rem" />
            {t("editor.avatar.crop")}
          </button>
        )}
        {children}
      </div>
      <Modal
        open={cropping && !!src}
        onClose={() => setCropping(false)}
        title={t("editor.avatar.crop")}
        width="max-w-lg"
      >
        {src && (
          <fieldset
            disabled={disabled}
            className="flex min-w-0 justify-center border-0 p-4 disabled:pointer-events-none disabled:opacity-60"
          >
            <AvatarCropWidget
              src={src}
              alt={alt}
              crop={crop}
              onChange={onCropChange}
              onRemove={
                onRemove
                  ? () => {
                      setCropping(false);
                      onRemove();
                    }
                  : undefined
              }
              removing={removing}
            />
          </fieldset>
        )}
      </Modal>
    </div>
  );
}
