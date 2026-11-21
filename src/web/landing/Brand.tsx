export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`wordmark ${className}`} aria-label="TAPEZERO">
      TAPEZER<span className="wm-zero">O</span>
    </span>
  );
}

/** Flat version of the glass zero (favicon, loading, light hero). Same silhouette, slant and doubled edge. */
export function ZeroMark({ size = 64, split = 0, className = '' }: { size?: number; split?: number; className?: string }) {
  const dx = 3 + split * 4;
  const dy = -2 - split * 3;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 80 80" aria-hidden="true">
      <defs>
        <linearGradient id="zg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFE2D2" />
          <stop offset="0.45" stopColor="#FFB394" />
          <stop offset="1" stopColor="#FF7A3A" />
        </linearGradient>
        <linearGradient id="ze" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB394" />
          <stop offset="1" stopColor="#FF6849" />
        </linearGradient>
      </defs>
      <g transform="skewX(-11) translate(12 0)">
        <path fillRule="evenodd" fill="url(#zg)" d="M38 8h4a20 20 0 0 1 20 20v24a20 20 0 0 1-20 20h-4a20 20 0 0 1-20-20V28A20 20 0 0 1 38 8Zm-1 16a6 6 0 0 0-6 6v20a6 6 0 0 0 6 6h6a6 6 0 0 0 6-6V30a6 6 0 0 0-6-6Z" />
        <path d="M44 11.5a16.5 16.5 0 0 1 14.5 16.5v6" fill="none" stroke="url(#ze)" strokeWidth="6" strokeLinecap="round" transform={`translate(${dx} ${dy})`} opacity="0.95" />
        <path d="M38 13.5c-5 0-12 3-14 12" fill="none" stroke="#FFF0E7" strokeOpacity="0.75" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}
