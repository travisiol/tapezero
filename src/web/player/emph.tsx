import type { ReactNode } from 'react';

const NUM = /([+−-]?\$?\d[\d.,]*\s?[kM%]?)/g;

/** Render a plain sentence with its numbers in bold, so the eye lands on them first. */
export function emph(text: string): ReactNode[] {
  return text.split(NUM).map((part, i) => (i % 2 ? <strong key={i}>{part}</strong> : part));
}
