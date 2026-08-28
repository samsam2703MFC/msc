/* Bottom sheet. The scrim closes it; the panel does not — a click inside is
   meant for the controls that live there. Escape closes too. */

import { useEffect, type ReactNode } from 'react';
import { C, R } from '../design/theme';

export function Sheet({
  onClose,
  zIndex,
  children,
  paddingBottom = 44,
  gap = 16,
  scrollable = false,
  label,
}: {
  onClose: () => void;
  zIndex: number;
  children: ReactNode;
  paddingBottom?: number;
  gap?: number;
  scrollable?: boolean;
  label: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex,
        background: C.scrim,
        display: 'flex',
        alignItems: 'flex-end',
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        onClick={(e) => e.stopPropagation()}
        className={scrollable ? 'msc-scroll' : undefined}
        style={{
          width: '100%',
          maxHeight: scrollable ? '88%' : undefined,
          background: C.surface,
          borderRadius: `${R.sheet}px ${R.sheet}px 0 0`,
          padding: `22px 22px ${paddingBottom}px`,
          display: 'flex',
          flexDirection: 'column',
          gap,
          boxShadow: C.shadowSheet,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function SheetCloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="msc-hover-emerald"
      onClick={onClick}
      style={{
        borderRadius: R.md,
        padding: 12,
        textAlign: 'center',
        fontSize: 15,
        fontWeight: 600,
        background: C.accent,
        color: C.accentInk,
      }}
    >
      {label}
    </button>
  );
}
