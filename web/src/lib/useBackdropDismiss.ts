import { useRef, type MouseEvent } from "react";

/**
 * Backdrop props for a modal that dismisses on a genuine click-away.
 *
 * It closes only when the pointer was BOTH pressed and released on the backdrop
 * itself (`target === currentTarget`). This fixes the annoying case where you start
 * selecting text *inside* the dialog (e.g. highlighting the app name) and release the
 * mouse *outside* it: that drag ends on the backdrop, which previously counted as a
 * click-away and closed the dialog. Now a drag that began inside is ignored.
 *
 * Spread the returned props onto the full-screen backdrop element. The inner dialog
 * no longer needs `stopPropagation` - a click inside it has a non-backdrop target.
 */
export function useBackdropDismiss(onClose: () => void) {
  const pressedBackdrop = useRef(false);
  return {
    onMouseDown: (e: MouseEvent) => {
      pressedBackdrop.current = e.target === e.currentTarget;
    },
    onClick: (e: MouseEvent) => {
      if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
      pressedBackdrop.current = false;
    },
  };
}
