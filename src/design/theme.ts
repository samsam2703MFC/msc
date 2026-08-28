/* The slice of the Franchise Generation palette the app draws with.
   Values match tokens/colors.css; they live here as literals because the
   screens set colours inline, alongside dimensions the CSS never sees. */

export const C = {
  /* surfaces */
  page: '#F6F9F8', //  --neutral-50
  surface: '#FFFFFF', //  --neutral-0
  surfaceAlt: '#E3EEEC', //  --neutral-100
  border: '#C8D7D4', //  --neutral-200
  borderSoft: '#E3EEEC', //  --neutral-100, row separators

  /* text */
  ink: '#0A1C33', //  --navy-800
  inkBody: '#2E3842', //  --neutral-700
  inkMuted: '#44505C', //  --neutral-600
  inkSecondary: '#5C6B7A', //  --neutral-500
  inkQuiet: '#7E9090', //  --neutral-400

  /* action — there is exactly one "go" colour */
  accent: '#02C9A0', //  --emerald-400
  accentHover: '#3FDDB2', //  --emerald-300
  accentInk: '#022B25', //  --emerald-900, text on the accent fill
  accentDeep: '#038870', //  --emerald-600
  accentSoft: '#E6FBF5', //  --emerald-50
  accentBar: '#02A988', //  --emerald-500, data bars

  /* supporting */
  teal: '#05666F', //  --teal-500, eyebrows
  warning: '#BA7517', //  --warning
  warningBg: '#FAEEDA', //  --warning-bg
  negative: '#D85A30', //  --brand-brazier, the disconnected-source dot

  /* elevation */
  shadowCard: '0 1px 3px rgba(10,28,51,0.07)', //  --shadow-card
  shadowSheet: '0 -8px 32px rgba(10,28,51,0.18)',
  scrim: 'rgba(10,28,51,0.45)',
} as const;

export const F = {
  display: 'Archivo, sans-serif',
  body: 'Inter, sans-serif',
  mono: "'JetBrains Mono', monospace",
} as const;

export const R = {
  sm: 6,
  md: 10,
  card: 16,
  sheet: 20,
  full: 999,
} as const;
