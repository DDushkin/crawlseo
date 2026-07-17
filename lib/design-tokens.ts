/**
 * Atomize Design System — code mirror of Figma/React tokens
 * @see https://atomizedesign.com/
 * @see https://github.com/proksh/atomize/blob/master/src/core/THEME.js
 */
export const atomize = {
  colors: {
    black900: "#0A1F44",
    black800: "#14284B",
    black700: "#283A5B",
    gray900: "#8A94A6",
    gray400: "#E1E4E8",
    gray300: "#F1F2F4",
    gray200: "#F7F8F9",
    gray100: "#FAFBFB",
    brand900: "#FF584A",
    success900: "#136A4A",
    success700: "#36AB80",
    warning900: "#EF8511",
    warning700: "#F7AF22",
    danger900: "#A32801",
    danger700: "#F4541D",
    info900: "#01408F",
    info800: "#026DD6",
    info700: "#0284FE",
    info600: "#4BA7FE",
    white: "#FFFFFF",
  },
  /** 4pt grid */
  space: {
    1: 4,
    2: 8,
    3: 12,
    4: 16,
    5: 20,
    6: 24,
    8: 32,
    10: 40,
  },
  radius: {
    xs: 2,
    sm: 4,
    md: 6,
    lg: 8,
    xl: 12,
  },
  textSize: {
    tiny: 10,
    caption: 12,
    body: 14,
    subheader: 17,
    title: 22,
    heading: 26,
    display1: 32,
  },
  containerMaxWidth: 1156,
} as const;
