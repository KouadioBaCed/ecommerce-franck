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
  // Whether a form field inside the modal currently has focus. Some in-app
  // browsers (Facebook/Instagram in particular) never actually shrink or
  // reposition a `position: fixed` element for the on-screen keyboard —
  // the keyboard just overlays whatever pixels happen to be there, and no
  // amount of viewport-size math can recover content trapped behind it.
  //
  // The one thing that reliably works everywhere, including those
  // browsers, is the browser's own native behavior of scrolling the *page*
  // to keep a focused input above the keyboard — but that native behavior
  // only kicks in for elements in normal document flow, not for content
  // stuck inside a fixed ancestor. So instead of fighting the keyboard, we
  // release the modal from `position: fixed` to `absolute` (pinned to
  // wherever it visually was) the moment a field is focused, letting the
  // page scroll normally and the browser do what it already does well.
  const [fieldFocused, setFieldFocused] = useState(false);
  const scrollYOnFocus = useRef(0);

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const isFormField = (target: EventTarget | null) => {
      const tag = (target as HTMLElement | null)?.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
    };
    const onFocusIn = (e: FocusEvent) => {
      if (!isFormField(e.target)) return;
      scrollYOnFocus.current = window.scrollY;
      setFieldFocused(true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (isFormField(e.target)) setFieldFocused(false);
    };
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      setFieldFocused(false);
    };
  }, [open, onClose]);

  // Background scroll stays locked while idle, so the modal reads like a
  // normal fixed overlay. It's released the instant a field is focused so
  // the page (now holding the modal via `position: absolute`, see below)
  // can scroll under the browser's control.
  useEffect(() => {
    if (!open || fieldFocused) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open, fieldFocused]);

  if (!open) return null;

  return createPortal(
    <div
      className={`${fieldFocused ? 'absolute' : 'fixed'} inset-x-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4`}
      style={fieldFocused ? { top: scrollYOnFocus.current, minHeight: '100vh' } : { top: 0, bottom: 0 }}
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
        className={`relative w-full ${SIZES[size]} scrollbar-thin bg-white rounded-t-3xl sm:rounded-3xl shadow-elevated animate-slide-up ${
          fieldFocused ? '' : 'max-h-[85vh] overflow-y-auto'
        }`}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
