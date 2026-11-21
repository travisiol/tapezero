export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  if (new URLSearchParams(location.search).get('motion') === 'reduced') return true;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function webglAvailable(): boolean {
  if (new URLSearchParams(location.search).get('webgl') === '0') return false;
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

/** Light hero on weak devices: few cores, low memory, or save-data. */
export function preferLightHero(): boolean {
  const n = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  if (n.connection?.saveData) return true;
  if ((n.deviceMemory ?? 8) <= 2) return true;
  if ((navigator.hardwareConcurrency ?? 8) <= 2) return true;
  return false;
}

export async function copyText(t: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(t);
    return true;
  } catch {
    return false;
  }
}
