import { useEffect, useState, ReactNode } from 'react';
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

  useEffect(() => {
    if (!open) return;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const vv = window.visualViewport;
    const onViewportChange = () => {
      if (vv) setViewport({ height: vv.height, offsetTop: vv.offsetTop });
    };
    if (vv) {
      onViewportChange();
      vv.addEventListener('resize', onViewportChange);
      vv.addEventListener('scroll', onViewportChange);
    }

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
      if (vv) {
        vv.removeEventListener('resize', onViewportChange);
        vv.removeEventListener('scroll', onViewportChange);
      }
      setViewport(null);
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={viewport ? { top: viewport.offsetTop, height: viewport.height } : undefined}
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
        style={viewport ? { maxHeight: viewport.height * 0.92 } : undefined}
      >
        {children}
      </div>
    </div>,
    document.body
  );
}
