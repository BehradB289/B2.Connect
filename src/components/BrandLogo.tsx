import React from 'react';

export interface BrandLogoProps {
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  badgeText?: string;
  className?: string;
}

const SIZE_MAP: Record<NonNullable<BrandLogoProps['size']>, { box: number; textClass: string }> = {
  xs: { box: 26, textClass: 'text-sm' },
  sm: { box: 34, textClass: 'text-base' },
  md: { box: 42, textClass: 'text-lg' },
  lg: { box: 54, textClass: 'text-2xl' },
  xl: { box: 70, textClass: 'text-3xl' },
};

export const BrandLogo: React.FC<BrandLogoProps> = ({
  size = 'md',
  showText = true,
  badgeText,
  className = '',
}) => {
  const { box, textClass } = SIZE_MAP[size];
  const uniqueId = React.useId().replace(/[^a-zA-Z0-9]/g, '');

  return (
    <div className={`inline-flex items-center gap-2.5 select-none shrink-0 ${className}`}>
      <div
        className="relative flex items-center justify-center shrink-0 rounded-xl shadow-lg bg-[#0A0705]"
        style={{ width: box, height: box }}
      >
        <svg
          width={box}
          height={box}
          viewBox="0 0 64 64"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-label="B2.Connect Emblem"
          role="img"
        >
          <defs>
            <linearGradient id={`bg-grad-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1A120D" />
              <stop offset="100%" stopColor="#070504" />
            </linearGradient>
            <linearGradient id={`crema-border-${uniqueId}`} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#FDE68A" />
              <stop offset="50%" stopColor="#D4A373" />
              <stop offset="100%" stopColor="#B45309" />
            </linearGradient>
            <linearGradient id={`b2-text-${uniqueId}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#FFFFFF" />
              <stop offset="65%" stopColor="#FDE68A" />
              <stop offset="100%" stopColor="#E6A15C" />
            </linearGradient>
            <radialGradient id={`dot-glow-${uniqueId}`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#FBBF24" stopOpacity="1" />
              <stop offset="50%" stopColor="#D97706" stopOpacity="0.9" />
              <stop offset="100%" stopColor="#D97706" stopOpacity="0" />
            </radialGradient>
          </defs>

          {/* High-Contrast Deep Espresso Squircle Base */}
          <rect
            x="2"
            y="2"
            width="60"
            height="60"
            rx="15"
            fill={`url(#bg-grad-${uniqueId})`}
            stroke={`url(#crema-border-${uniqueId})`}
            strokeWidth="3"
          />

          {/* Inner Contrast Frame */}
          <rect
            x="5.5"
            y="5.5"
            width="53"
            height="53"
            rx="12"
            fill="#0A0705"
            stroke="#D4A373"
            strokeOpacity="0.28"
            strokeWidth="1"
          />

          {/* Ultra-Crisp High-Contrast B2 Monogram with Dark Outline Guard */}
          <text
            x="8.5"
            y="43.5"
            fill={`url(#b2-text-${uniqueId})`}
            stroke="#050302"
            strokeWidth="2.5"
            style={{ paintOrder: 'stroke fill' }}
            fontFamily="'Plus Jakarta Sans', 'Inter', system-ui, sans-serif"
            fontWeight="900"
            fontSize="30"
            letterSpacing="-1.2"
          >
            B2
          </text>

          {/* Signature Glowing Amber-Gold Period (.) */}
          <circle cx="51.5" cy="39" r="8.5" fill={`url(#dot-glow-${uniqueId})`} />
          <circle cx="51.5" cy="39" r="4.6" fill="#F59E0B" stroke="#050302" strokeWidth="1.2" />
          <circle cx="50.2" cy="37.6" r="1.5" fill="#FFFFFF" />
        </svg>
      </div>

      {showText && (
        <div className="flex items-baseline gap-2 whitespace-nowrap">
          <span className={`font-black tracking-tight text-[var(--text-primary)] ${textClass}`}>
            B2<span className="text-[#D97706] dark:text-[#F59E0B]">.</span>Connect
          </span>
          {badgeText && (
            <span className="text-xs font-medium text-[var(--text-muted)] tracking-normal">
              · {badgeText}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default BrandLogo;
