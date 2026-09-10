/* The header both detail sheets share: type square, eyebrow + title, and the
   emerald gain pill on the right. */

import type { ReactNode } from 'react';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';

export function SheetHeading({
  icon,
  color,
  eyebrow,
  eyebrowColor,
  title,
  titleSize,
  trailing,
  onType,
}: {
  icon: string;
  color: string;
  eyebrow: string;
  eyebrowColor: string;
  title: string;
  titleSize: number;
  trailing?: ReactNode;
  /** Quand le carré et le bandeau ouvrent la fiche du type. */
  onType?: () => void;
}) {
  const carre = (
    <div
      style={{
        width: 44,
        height: 44,
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${color}`,
        color,
        flexShrink: 0,
      }}
    >
      <Icon name={icon} size={22} />
    </div>
  );
  const bandeau = (
    <div
      style={{
        fontSize: 10,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        color: eyebrowColor,
        fontWeight: 600,
        display: 'flex',
        alignItems: 'center',
        gap: 4,
      }}
    >
      {eyebrow}
      {onType && <Icon name="chevron-right" size={11} />}
    </div>
  );
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      {onType ? (
        <button type="button" className="msc-hover-accent" onClick={onType} aria-label={eyebrow} style={{ padding: 0, borderRadius: 12 }}>
          {carre}
        </button>
      ) : carre}
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 3 }}>
        {onType ? (
          <button type="button" className="msc-hover-accent" onClick={onType} style={{ padding: 0, alignSelf: 'flex-start', textAlign: 'left' }}>
            {bandeau}
          </button>
        ) : bandeau}
        <div
          style={{
            fontFamily: F.display,
            fontSize: titleSize,
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: C.ink,
            lineHeight: 1.2,
          }}
        >
          {title}
        </div>
      </div>
      {trailing}
    </div>
  );
}

export function GainPill({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '6px 12px',
        borderRadius: R.full,
        background: C.accentSoft,
        color: C.accentDeep,
        flexShrink: 0,
      }}
    >
      <Icon name="trending-up" size={14} />
      <div style={{ fontSize: 12, fontWeight: 600 }}>{children}</div>
    </div>
  );
}
