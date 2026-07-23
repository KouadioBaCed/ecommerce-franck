import { useEffect, useRef, useState, ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

const SIZES: Record<NonNullable<ModalProps['size']>, string> = {
  sm: 'sm:max-w-sm',
  md: 'sm:max-w-md',
  lg: 'sm:max-w-lg',
};

/**
 * Portal-based modal rendered directly on <body>, so it escapes any parent
 * stacking context / transform / overflow (which is what caused the odd
 * shadow behind the previous inline modal). Locks body scroll and closes on
 * Escape or backdrop click.
 */
export function Modal({ open, onClose, children, size = 'md' }: ModalProps) {
  // Tracks the visualViewport (the area actually visible above the mobile
  // keyboard) so the sheet resizes/repositions instead of letting the
  // keyboard cover its inputs — `100vh`/`inset-0` don't shrink on their own.
  const [viewport, setViewport] = useState<{ height: number; offsetTop: number } | null>(null);
  // Some in-app browsers (Facebook/Instagram) report a buggy, undersized
  // visualViewport.height from the moment the page loads — not just once the
  // keyboard opens. Applying that reading unconditionally clipped the sheet
  // down to ~2 fields immediately on open, well before any keyboard existed.
  // Only trust the shrink once a field is actually focused.
  const [fieldFocused, setFieldFocused] = useState(false);
  // Height captured once when the modal opens (before any keyboard). We
  // compare later readings against this fixed baseline rather than a live
  // `window.innerHeight` — some Android WebViews (including Facebook's
  // in-app browser) shrink `window.innerHeight` itself in lockstep with the
  // keyboard, which would make a live comparison always ~1:1 and never
  // detect that the keyboard opened at all.
  const baselineHeight = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const isFormField = (target: EventTarget | null) => {
      const tag = (target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onFocusIn = (e: FocusEvent) => {
      if (isFormField(e.target)) setFieldFocused(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isFormField(e.target)) setFieldFocused(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    const vv = window.visualViewport;
    const readHeight = () => vv?.height ?? window.innerHeight;
    const readOffsetTop = () => vv?.offsetTop ?? 0;

    baselineHeight.current = readHeight();
    const onViewportChange = () => setViewport({ height: readHeight(), offsetTop: readOffsetTop() });
    onViewportChange();

    // Not every in-app WebView implements visualViewport reliably — fall
    // back to window resize (Android WebViews typically shrink
    // window.innerHeight directly when the keyboard opens).
    if (vv) {
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
    } else {
      window.addEventListener('resize', onViewportChange);
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      if (vv) {
        vv.removeEventListener('resize', onViewportChange);
        vv.removeEventListener('scroll', onViewportChange);
      } else {
        window.removeEventListener('resize', onViewportChange);
      }
      setViewport(null);
      setFieldFocused(false);
      baselineHeight.current = null;
    };
  }, [open, onClose]);

  if (!open) return null;

  const keyboardOpen =
    fieldFocused &&
    viewport !== null &&
    baselineHeight.current !== null &&
    viewport.height < baselineHeight.current * 0.85;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={keyboardOpen ? { top: viewport.offsetTop, height: viewport.height } : undefined}
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop (single clean layer) */}
      <div
        className="absolute inset-0 bg-ink/50 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div
        className={`relative w-full ${SIZES[size]} max-h-[92vh] overflow-y-auto scrollbar-thin bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated animate-slide-up`}
        style={keyboardOpen ? { maxHeight: viewport.height * 0.92 } : undefined}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
