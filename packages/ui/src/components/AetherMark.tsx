import type { CSSProperties } from 'react';

export interface AetherMarkProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
  withGlow?: boolean;
  title?: string;
}

let uidCounter = 0;
function nextUid() {
  uidCounter += 1;
  return `aether-mark-grad-${uidCounter}`;
}

export function AetherMark({
  size = 28,
  className,
  style,
  withGlow = false,
  title,
}: AetherMarkProps) {
  const uid = nextUid();

  const svg = (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
      style={{ display: 'block' }}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={uid} x1="15%" y1="0%" x2="85%" y2="100%">
          <stop offset="0%" style={{ stopColor: 'var(--aurora-1)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--aurora-2)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--aurora-3)' }} />
        </linearGradient>
      </defs>

      <circle
        cx="20"
        cy="20"
        r="18"
        stroke={`url(#${uid})`}
        strokeWidth="0.75"
        fill="none"
        opacity="0.35"
      />
      <circle
        cx="20"
        cy="20"
        r="13.5"
        stroke={`url(#${uid})`}
        strokeWidth="0.5"
        fill="none"
        opacity="0.25"
      />

      <path
        d="M 20 2.5
           L 21.4 17
           L 37.5 18.8
           L 21.4 21
           L 20 37.5
           L 18.6 21
           L 2.5 18.8
           L 18.6 17 Z"
        fill={`url(#${uid})`}
      />
      <path
        d="M 20 7.5
           L 21 19.2
           L 32.5 20
           L 21 20.8
           L 20 32.5
           L 19 20.8
           L 7.5 20
           L 19 19.2 Z"
        fill={`url(#${uid})`}
        opacity="0.55"
        transform="rotate(45 20 20)"
      />

      <circle cx="20" cy="20" r="2.4" fill="white" opacity="0.95" />
      <circle cx="20" cy="20" r="0.8" fill={`url(#${uid})`} />
    </svg>
  );

  if (!withGlow) {
    return (
      <span
        className={className}
        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', ...style }}
      >
        {svg}
      </span>
    );
  }

  const glowStyle: CSSProperties = {
    position: 'relative',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    ...style,
  };

  return (
    <span className={className} style={glowStyle}>
      <span
        aria-hidden="true"
        style={{
          content: '""',
          position: 'absolute',
          inset: -6,
          borderRadius: 9999,
          background:
            'radial-gradient(circle, color-mix(in oklch, var(--aurora-1) 22%, transparent) 0%, transparent 70%)',
          filter: 'blur(10px)',
          zIndex: -1,
          opacity: 0.7,
          pointerEvents: 'none',
        }}
      />
      {svg}
    </span>
  );
}
