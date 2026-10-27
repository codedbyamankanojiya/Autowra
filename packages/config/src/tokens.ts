/**
 * Design tokens.
 *
 * One source of truth for colour, type, spacing, radii, elevation and
 * component sizing. The React Native apps consume these objects directly and
 * the admin dashboard mirrors them in `tailwind.config.ts`.
 *
 * Direction: deep charcoal / navy base, white surfaces, restrained blue accent.
 * No gradients as a crutch, no glass effects, no emoji iconography.
 */

export const palette = {
  /** Brand base - deep navy charcoal. */
  ink900: '#0B1220',
  ink800: '#111A2B',
  ink700: '#1B2637',
  ink600: '#2A3448',
  ink500: '#3D4A5C',
  ink400: '#5A6779',
  ink300: '#8A94A6',
  ink200: '#C3CAD6',
  ink100: '#E4E8EF',
  ink50: '#F4F6FA',

  white: '#FFFFFF',

  /** Primary accent - restrained blue. */
  blue900: '#0B2E5C',
  blue800: '#12406F',
  blue700: '#155296',
  blue600: '#1668BE',
  blue500: '#1E7FE0',
  blue400: '#4E9BEA',
  blue300: '#8DBEF3',
  blue100: '#DCEAFB',
  blue50: '#EFF6FE',

  /** Supporting hues - used only for status, never as decoration. */
  green600: '#15803D',
  green100: '#DCFCE7',
  amber600: '#B45309',
  amber100: '#FEF3C7',
  red600: '#B91C1C',
  red100: '#FEE2E2',
  teal600: '#0F766E',
  teal100: '#CCFBF1',
} as const;

/**
 * Semantic colours. Screens must reference these names rather than raw palette
 * entries so a theme change stays in one file.
 */
export const colors = {
  background: palette.ink50,
  backgroundElevated: palette.white,
  surface: palette.white,
  surfaceMuted: palette.ink100,
  surfaceInverse: palette.ink900,

  border: palette.ink200,
  borderStrong: palette.ink300,
  divider: palette.ink100,

  textPrimary: palette.ink900,
  textSecondary: palette.ink500,
  textTertiary: palette.ink400,
  textInverse: palette.white,
  textOnAccent: palette.white,
  textLink: palette.blue700,

  accent: palette.blue600,
  accentHover: palette.blue700,
  accentMuted: palette.blue100,
  accentSubtle: palette.blue50,

  success: palette.green600,
  successMuted: palette.green100,
  warning: palette.amber600,
  warningMuted: palette.amber100,
  danger: palette.red600,
  dangerMuted: palette.red100,
  info: palette.teal600,
  infoMuted: palette.teal100,

  overlay: 'rgba(11, 18, 32, 0.55)',
  skeleton: palette.ink100,
} as const;

export type ColorName = keyof typeof colors;

/** Letter-spacing values tuned for the two platform system font families. */
export const fontSize = {
  xs: 12,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  '2xl': 24,
  '3xl': 30,
  '4xl': 36,
} as const;

export const lineHeight = {
  xs: 16,
  sm: 18,
  md: 22,
  lg: 24,
  xl: 28,
  '2xl': 32,
  '3xl': 38,
  '4xl': 44,
} as const;

export const fontWeight = {
  regular: '400',
  medium: '500',
  semibold: '600',
  bold: '700',
} as const;

/**
 * Type ramp. `display` / `title` / `heading` / `body` / `caption` are the
 * styles screens should use; `fontSize`/`lineHeight` stay exported for the odd
 * one-off that does not fit the ramp.
 */
export const typography = {
  display: { fontSize: fontSize['4xl'], lineHeight: lineHeight['4xl'], fontWeight: fontWeight.bold, letterSpacing: -0.6 },
  title: { fontSize: fontSize['3xl'], lineHeight: lineHeight['3xl'], fontWeight: fontWeight.bold, letterSpacing: -0.4 },
  heading: { fontSize: fontSize.xl, lineHeight: lineHeight.xl, fontWeight: fontWeight.semibold, letterSpacing: -0.2 },
  subheading: { fontSize: fontSize.lg, lineHeight: lineHeight.lg, fontWeight: fontWeight.semibold, letterSpacing: -0.1 },
  bodyStrong: { fontSize: fontSize.md, lineHeight: lineHeight.md, fontWeight: fontWeight.semibold, letterSpacing: 0 },
  body: { fontSize: fontSize.md, lineHeight: lineHeight.md, fontWeight: fontWeight.regular, letterSpacing: 0 },
  bodySmall: { fontSize: fontSize.sm, lineHeight: lineHeight.sm, fontWeight: fontWeight.regular, letterSpacing: 0 },
  label: { fontSize: fontSize.sm, lineHeight: lineHeight.sm, fontWeight: fontWeight.semibold, letterSpacing: 0.4 },
  caption: { fontSize: fontSize.xs, lineHeight: lineHeight.xs, fontWeight: fontWeight.regular, letterSpacing: 0.2 },
  overline: { fontSize: fontSize.xs, lineHeight: lineHeight.xs, fontWeight: fontWeight.semibold, letterSpacing: 1.2 },
  price: { fontSize: fontSize['2xl'], lineHeight: lineHeight['2xl'], fontWeight: fontWeight.bold, letterSpacing: -0.4 },
} as const;

export type TypographyName = keyof typeof typography;

/** 4pt spacing scale. */
export const spacing = {
  none: 0,
  xxs: 2,
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 24,
  '3xl': 32,
  '4xl': 40,
  '5xl': 48,
  '6xl': 64,
} as const;

export type SpacingName = keyof typeof spacing;

export const radii = {
  none: 0,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  '2xl': 28,
  pill: 999,
} as const;

export type RadiusName = keyof typeof radii;

/**
 * Elevation expressed as React Native shadow props plus the Android
 * `elevation` value. Keeping both avoids platform drift.
 */
export const elevation = {
  none: { shadowColor: 'transparent', shadowOpacity: 0, shadowRadius: 0, shadowOffset: { width: 0, height: 0 }, elevation: 0 },
  sm: { shadowColor: '#0B1220', shadowOpacity: 0.06, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 1 },
  md: { shadowColor: '#0B1220', shadowOpacity: 0.08, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 3 },
  lg: { shadowColor: '#0B1220', shadowOpacity: 0.12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 }, elevation: 8 },
  xl: { shadowColor: '#0B1220', shadowOpacity: 0.18, shadowRadius: 32, shadowOffset: { width: 0, height: 14 }, elevation: 14 },
} as const;

export type ElevationName = keyof typeof elevation;

export const iconSize = {
  xs: 14,
  sm: 18,
  md: 22,
  lg: 28,
  xl: 36,
} as const;

export type IconSizeName = keyof typeof iconSize;

/** Minimum accessible touch target (Android 48dp, iOS 44pt). */
export const touchTarget = { min: 48, comfortable: 56 } as const;

export const controlHeight = {
  sm: 40,
  md: 48,
  lg: 56,
} as const;

export const layout = {
  screenPaddingX: spacing.lg,
  screenPaddingY: spacing.lg,
  maxContentWidth: 720,
  tabBarHeight: 64,
  headerHeight: 56,
} as const;

export const zIndex = {
  base: 0,
  card: 1,
  header: 10,
  sticky: 20,
  overlay: 100,
  modal: 200,
  toast: 300,
} as const;

export const motion = {
  fast: 120,
  base: 200,
  slow: 320,
} as const;

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/** Button variants as plain data so Button/IconButton stay presentational. */
export const buttonVariants: Record<
  ButtonVariant,
  { background: string; backgroundPressed: string; text: string; border: string }
> = {
  primary: { background: colors.accent, backgroundPressed: colors.accentHover, text: colors.textOnAccent, border: 'transparent' },
  secondary: { background: colors.surfaceInverse, backgroundPressed: palette.ink700, text: colors.textInverse, border: 'transparent' },
  outline: { background: colors.surface, backgroundPressed: colors.accentSubtle, text: colors.textPrimary, border: colors.borderStrong },
  ghost: { background: 'transparent', backgroundPressed: colors.accentSubtle, text: colors.textLink, border: 'transparent' },
  danger: { background: colors.danger, backgroundPressed: '#991B1B', text: colors.textInverse, border: 'transparent' },
};

export const buttonSizes: Record<ButtonSize, { height: number; paddingX: number; fontSize: number }> = {
  sm: { height: controlHeight.sm, paddingX: spacing.md, fontSize: fontSize.sm },
  md: { height: controlHeight.md, paddingX: spacing.lg, fontSize: fontSize.md },
  lg: { height: controlHeight.lg, paddingX: spacing.xl, fontSize: fontSize.lg },
};

/** Input styles shared by every form control. */
export const inputStyles = {
  height: controlHeight.md,
  multilineMinHeight: 96,
  borderWidth: 1,
  borderColorFocused: colors.accent,
  borderColorBlurred: colors.border,
  borderColorError: colors.danger,
  background: colors.surface,
  backgroundDisabled: colors.surfaceMuted,
  textColor: colors.textPrimary,
  placeholderColor: colors.textTertiary,
  labelColor: colors.textSecondary,
  helperColor: colors.textTertiary,
  errorColor: colors.danger,
  paddingX: spacing.md,
  radius: radii.md,
} as const;

/** Status colours for booking / job / payment badges. */
export const statusColors = {
  neutral: { text: colors.textSecondary, background: colors.surfaceMuted },
  accent: { text: palette.blue800, background: colors.accentMuted },
  success: { text: colors.success, background: colors.successMuted },
  warning: { text: colors.warning, background: colors.warningMuted },
  danger: { text: colors.danger, background: colors.dangerMuted },
  info: { text: colors.info, background: colors.infoMuted },
} as const;

export type StatusTone = keyof typeof statusColors;

export const theme = {
  palette,
  colors,
  fontSize,
  lineHeight,
  fontWeight,
  typography,
  spacing,
  radii,
  elevation,
  iconSize,
  touchTarget,
  controlHeight,
  layout,
  zIndex,
  motion,
  buttonVariants,
  buttonSizes,
  inputStyles,
  statusColors,
} as const;

export type Theme = typeof theme;
