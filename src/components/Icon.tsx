/* Renders a Lucide glyph by its database name.
   Stroke weight matches the design system's 1.75px rule. */

import { ICONS } from './icons';

export interface IconProps {
  name: string;
  size: number;
  color?: string;
  style?: React.CSSProperties;
}

export function Icon({ name, size, color, style }: IconProps) {
  const Glyph = ICONS[name];
  if (!Glyph) {
    if (import.meta.env.DEV) console.warn(`Icon: unknown glyph "${name}" — add it to icons.ts`);
    return null;
  }
  return (
    <Glyph
      aria-hidden
      width={size}
      height={size}
      color={color}
      strokeWidth={1.75}
      style={{ flexShrink: 0, ...style }}
    />
  );
}
