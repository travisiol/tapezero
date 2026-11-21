// TAPEZERO art direction — coral glass on deep bordeaux. Shared by web, canvas charts, 3D and film.
export const C = {
  bg: '#1D0C19', // deep background
  bordeaux: '#321221',
  surface: '#251321', // terminal panels (matte)
  chart: '#2A1525', // chart surface, slightly lighter than panels
  divider: '#482638',
  grid: '#3A1E30', // technical grid behind curves (sober)
  accent: '#FF6849', // coral — playhead, primary action, current selection
  orange: '#FF8738',
  peach: '#FFB394',
  text: '#FFF0E7', // cream
  text2: '#C9ADB7',
  // Market sides: always paired with a shape (▲ filled / ▼ hollow) and a label (BUY / SELL)
  buy: '#8FDCB8',
  sell: '#F4A0C0',
} as const;

export const FONT_SANS = "'Space Grotesk', system-ui, sans-serif";
export const FONT_MONO = "'IBM Plex Mono', ui-monospace, monospace";

export const alpha = (hex: string, a: number) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
