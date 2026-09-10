/* The handful of shapes every screen repeats: the card, the eyebrow, the
   uppercase section label, the type tag in its two forms, the accent button,
   and the small bar charts. */

import type { CSSProperties, ReactNode } from 'react';
import { C, F, R } from '../design/theme';
import { Icon } from './Icon';

export function Card({
  children,
  featured = false,
  borderColor,
  background,
  padding = 18,
  gap = 12,
  style,
}: {
  children: ReactNode;
  /** 2px emerald border — the design system's way of flagging the live item. */
  featured?: boolean;
  borderColor?: string;
  background?: string;
  padding?: number | string;
  gap?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      style={{
        borderRadius: R.card,
        background: background ?? C.surface,
        border: `${featured ? 2 : 1}px solid ${borderColor ?? (featured ? C.accent : C.border)}`,
        boxShadow: C.shadowCard,
        padding,
        display: 'flex',
        flexDirection: 'column',
        gap,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/** Short letterspaced uppercase label — the one uppercase element in the system. */
export function SectionLabel({
  icon,
  children,
  color = C.inkSecondary,
  iconColor,
  size = 10,
}: {
  icon?: string;
  children: ReactNode;
  color?: string;
  iconColor?: string;
  size?: number;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 7, color }}>
      {icon && <Icon name={icon} size={15} color={iconColor} />}
      <div
        style={{
          fontSize: size,
          letterSpacing: '0.1em',
          textTransform: 'uppercase',
          fontWeight: 600,
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function Mono({
  children,
  size = 12,
  color = C.inkSecondary,
  style,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
  style?: CSSProperties;
}) {
  return <div style={{ fontFamily: F.mono, fontSize: size, color, ...style }}>{children}</div>;
}

/** The type tag as a labelled chip — used where there is room for the word. */
export function TypeChip({
  label,
  icon,
  color,
  onClick,
  info = false,
  compact = false,
}: {
  label: string;
  icon: string;
  color: string;
  onClick?: () => void;
  /** Trailing (i) that hints the chip opens the type sheet. */
  info?: boolean;
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 6 : 7,
        padding: compact ? '3px 8px' : '5px 10px 5px 8px',
        borderRadius: R.sm,
        border: `1px solid ${color}`,
        background: compact ? 'transparent' : C.page,
        color,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Icon name={icon} size={compact ? 13 : 15} />
      <div
        style={{
          fontSize: compact ? 10 : 11,
          fontWeight: 700,
          letterSpacing: compact ? '0.06em' : '0.08em',
          textTransform: 'uppercase',
        }}
      >
        {label}
      </div>
      {info && <Icon name="info" size={13} style={{ opacity: 0.6 }} />}
    </button>
  );
}

/** The type tag as a bare square — used in dense rows. */
export function TypeSquare({
  icon,
  color,
  size = 32,
  onClick,
  label,
}: {
  icon: string;
  color: string;
  size?: number;
  onClick?: () => void;
  label?: string;
}) {
  return (
    <button
      type="button"
      onClick={
        onClick &&
        ((e) => {
          e.stopPropagation();
          onClick();
        })
      }
      aria-label={label}
      style={{
        width: size,
        height: size,
        borderRadius: size >= 40 ? 12 : 8,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px solid ${color}`,
        color,
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <Icon name={icon} size={Math.round(size * 0.52)} />
    </button>
  );
}

/** Solid emerald with dark-emerald text; once active it inverts to the tint. */
export function AccentButton({
  label,
  icon,
  active = false,
  onClick,
  full = true,
  size = 'lg',
}: {
  label: string;
  icon: string;
  active?: boolean;
  onClick?: () => void;
  full?: boolean;
  size?: 'lg' | 'sm';
}) {
  const lg = size === 'lg';
  return (
    <button
      type="button"
      className="msc-hover-bright"
      onClick={onClick}
      style={{
        borderRadius: R.md,
        padding: lg ? 12 : '9px 14px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: lg ? 'center' : 'flex-start',
        alignSelf: full ? 'stretch' : 'flex-start',
        gap: lg ? 8 : 7,
        fontSize: lg ? 15 : 13,
        fontWeight: 600,
        background: active ? C.accentSoft : C.accent,
        color: active ? C.accentDeep : C.accentInk,
        border: `1px solid ${C.accent}`,
        cursor: 'pointer',
      }}
    >
      <Icon name={icon} size={lg ? 18 : 15} />
      <div>{label}</div>
    </button>
  );
}

export interface BarSpec {
  h: string;
  bg: string;
}

/** Scales a series to the tallest value; anything over `seuil` turns amber. */
export function bars(values: number[], seuil: number | undefined, warn: string): BarSpec[] {
  const max = Math.max(...values);
  return values.map((v) => ({
    h: `${Math.round((v / max) * 100)}%`,
    bg: seuil && v > seuil ? warn : C.accentBar,
  }));
}

export function BarChart({
  data,
  height,
  gap,
  labels,
}: {
  data: BarSpec[];
  height: number;
  gap: number;
  labels?: string[];
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap, height }}>
      {data.map((b, i) => {
        /* The bar's height is a percentage, so every ancestor up to the fixed
           `height` needs a definite height of its own or it collapses to zero. */
        const bar = (
          <div style={{ flex: 1, display: 'flex', alignItems: 'flex-end', width: '100%' }}>
            <div
              style={{
                width: '100%',
                borderRadius: '3px 3px 0 0',
                background: b.bg,
                height: b.h,
              }}
            />
          </div>
        );
        return labels ? (
          <div
            key={i}
            style={{
              flex: 1,
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 5,
            }}
          >
            {bar}
            <Mono size={9} color={C.inkQuiet}>
              {labels[i]}
            </Mono>
          </div>
        ) : (
          <div key={i} style={{ flex: 1, height: '100%', display: 'flex' }}>
            {bar}
          </div>
        );
      })}
    </div>
  );
}

/** Three-up figure + caption, used for paces, week totals and analysis stats. */
export function StatCell({
  icon,
  value,
  label,
  color = C.ink,
  iconColor,
  sub,
}: {
  icon: string;
  value: string;
  label: string;
  color?: string;
  iconColor?: string;
  sub?: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: iconColor ?? color }}>
        <Icon name={icon} size={14} />
        <div style={{ fontFamily: F.mono, fontSize: 14 }}>{value}</div>
      </div>
      <div style={{ fontSize: 10, color: C.inkSecondary, lineHeight: 1.3 }}>{label}</div>
      {sub && (
        <Mono size={10} color={C.inkQuiet}>
          {sub}
        </Mono>
      )}
    </div>
  );
}

export function Grid({
  cols,
  gap,
  children,
}: {
  cols: number;
  gap: number;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${cols}, 1fr)`, gap }}>
      {children}
    </div>
  );
}

/** Icon + line of prose, the shape used for goals, steps and recalc entries. */
export function IconLine({
  icon,
  iconColor = C.accentDeep,
  iconSize = 18,
  children,
  color = C.inkBody,
  fontSize = 14,
  lineHeight = 1.5,
  lead,
  leadWidth = 44,
  leadSize = 12,
}: {
  icon: string;
  iconColor?: string;
  iconSize?: number;
  children: ReactNode;
  color?: string;
  fontSize?: number;
  lineHeight?: number;
  /** Monospaced column before the text — a duration, or a week range. */
  lead?: string;
  leadWidth?: number;
  leadSize?: number;
}) {
  return (
    <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
      <Icon
        name={icon}
        size={iconSize}
        color={iconColor}
        style={{ marginTop: iconSize >= 18 ? 2 : 3 }}
      />
      {lead !== undefined && (
        <Mono size={leadSize} color={C.accentDeep} style={{ minWidth: leadWidth, paddingTop: 2 }}>
          {lead}
        </Mono>
      )}
      <div style={{ fontSize, lineHeight, color }}>{children}</div>
    </div>
  );
}

/** Deux colonnes sur un écran large, une seule sur un téléphone : le bureau
    se sert de la largeur, le téléphone empile. */
export function Colonnes({
  large, gauche, droite, ratio = 'minmax(0, 1fr) minmax(0, 1fr)', gap = 12,
}: {
  large: boolean; gauche: ReactNode; droite: ReactNode; ratio?: string; gap?: number;
}) {
  if (!large) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap }}>
        {gauche}
        {droite}
      </div>
    );
  }
  return (
    <div style={{ display: 'grid', gridTemplateColumns: ratio, gap, alignItems: 'start' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }}>{gauche}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap, minWidth: 0 }}>{droite}</div>
    </div>
  );
}
