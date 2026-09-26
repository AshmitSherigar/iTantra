export const Brand = {
  ink: '#050517',
  ember: '#CF5C36',
  emberDark: '#9E4423',
  sand: '#EFC88B',
  paper: '#FAF3E6',
};

export const Colors = {
  light: {
    background: '#FAF3E6',
    surface: '#FFFDF7',
    card: '#FFFDF7',
    glass: 'rgba(255, 253, 247, 0.72)',
    text: '#050517',
    textSecondary: '#7C6B58',
    textTertiary: '#A2937D',
    border: '#E8D9BE',
    glassBorder: 'rgba(5, 5, 23, 0.08)',
    primary: '#CF5C36',
    brand: '#CF5C36',
    primaryDark: '#9E4423',
    primaryMuted: '#F6DECB',
    accent: '#A97E2F',
    accentMuted: '#F8E9CB',
    error: '#B8402A',
    errorMuted: '#F9E2DA',
    success: '#5B7F3C',
    successMuted: '#E6EBD3',
    warning: '#9A6B1A',
    warningMuted: '#F8ECD2',
    icon: '#5C4F3F',
    inputBackground: '#F3E9D3',
    shadow: 'rgba(5, 5, 23, 0.08)',
    tabBar: 'rgba(250, 243, 230, 0.86)',
    heroFrom: '#CF5C36',
    heroTo: '#050517',
  },
  dark: {
    background: '#050517',
    surface: '#0D0D24',
    card: '#0D0D24',
    glass: 'rgba(13, 13, 36, 0.72)',
    text: '#F7EDDC',
    textSecondary: '#A89A83',
    textTertiary: '#6E6355',
    border: 'rgba(239, 200, 139, 0.14)',
    glassBorder: 'rgba(239, 200, 139, 0.14)',
    primary: '#E8936B',
    brand: '#CF5C36',
    primaryDark: '#E8936B',
    primaryMuted: 'rgba(207, 92, 54, 0.24)',
    accent: '#EFC88B',
    accentMuted: 'rgba(239, 200, 139, 0.16)',
    error: '#F49073',
    errorMuted: 'rgba(184, 64, 42, 0.2)',
    success: '#A9C68B',
    successMuted: 'rgba(91, 127, 60, 0.24)',
    warning: '#F5B544',
    warningMuted: 'rgba(154, 107, 26, 0.24)',
    icon: '#D6C8B2',
    inputBackground: '#15152E',
    shadow: 'rgba(0, 0, 0, 0.5)',
    tabBar: 'rgba(5, 5, 23, 0.85)',
    heroFrom: '#CF5C36',
    heroTo: '#050517',
  },
};

export const FontSize = {
  small: 12,
  caption: 13,
  body: 15,
  medium: 17,
  h3: 18,
  h2: 22,
  title: 28,
  display: 34,
};

export const FontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
  extrabold: '800' as const,
};

/** Desert-dusk type pairing: Fraunces (warm display serif) + DM Sans (body). */
export const FontFamily = {
  display: 'Fraunces_900Black',
  heading: 'Fraunces_800ExtraBold',
  subhead: 'Fraunces_700Bold',
  body: 'DMSans_400Regular',
  bodyMedium: 'DMSans_500Medium',
  bold: 'DMSans_700Bold',
};

/** Fraunces display serif headers, DM Sans body — warm editorial scale. */
export const Typography = {
  display: {
    fontFamily: FontFamily.display,
    fontSize: 34,
    fontWeight: '800' as const,
    letterSpacing: -0.4,
    lineHeight: 40,
  },
  title: {
    fontFamily: FontFamily.heading,
    fontSize: 28,
    fontWeight: '800' as const,
    letterSpacing: -0.6,
    lineHeight: 34,
  },
  h2: {
    fontFamily: FontFamily.subhead,
    fontSize: 22,
    fontWeight: '700' as const,
    letterSpacing: -0.2,
    lineHeight: 28,
  },
  h3: {
    fontFamily: FontFamily.bold,
    fontSize: 17,
    fontWeight: '600' as const,
    letterSpacing: -0.1,
    lineHeight: 22,
  },
  body: {
    fontFamily: FontFamily.body,
    fontSize: 15,
    fontWeight: '400' as const,
    lineHeight: 22,
  },
  bodyMedium: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 15,
    fontWeight: '500' as const,
    lineHeight: 22,
  },
  caption: {
    fontFamily: FontFamily.bodyMedium,
    fontSize: 13,
    fontWeight: '500' as const,
    lineHeight: 18,
  },
  overline: {
    fontFamily: FontFamily.bold,
    fontSize: 11,
    fontWeight: '700' as const,
    letterSpacing: 1.4,
    textTransform: 'uppercase' as const,
  },
};

export const Radius = {
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  card: 28,
  round: 999,
};

export const Spacing = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 40 };

export const Shadows = {
  card: {
    shadowColor: '#050517',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 18,
    elevation: 3,
  },
  floating: {
    shadowColor: '#050517',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 30,
    elevation: 10,
  },
  glow: {
    shadowColor: '#CF5C36',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 6,
  },
};
