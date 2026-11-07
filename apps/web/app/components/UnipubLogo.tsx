"use client";

import { useId } from "react";

export interface UnipubLogoProps {
  size?: number;
  className?: string;
  showText?: boolean;
  variant?: "default" | "minimal" | "geometric";
}

type LogoIds = {
  grad1: string;
  grad2: string;
  grad3: string;
  mainGrad: string;
  glow: string;
};

function buildLogoIds(seed: string): LogoIds {
  return {
    grad1: `${seed}-grad1`,
    grad2: `${seed}-grad2`,
    grad3: `${seed}-grad3`,
    mainGrad: `${seed}-mainGrad`,
    glow: `${seed}-glow`,
  };
}

function LogoDefs({ ids, animated }: { ids: LogoIds; animated: boolean }) {
  return (
    <defs>
      <linearGradient id={ids.grad1} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#3b82f6" />
        <stop offset="50%" stopColor="#8b5cf6" />
        <stop offset="100%" stopColor="#ec4899" />
      </linearGradient>
      <linearGradient id={ids.grad2} x1="100%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#06b6d4" />
        <stop offset="100%" stopColor="#8b5cf6" />
      </linearGradient>
      <linearGradient id={ids.grad3} x1="0%" y1="100%" x2="100%" y2="0%">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#ef4444" />
      </linearGradient>
      <linearGradient id={ids.mainGrad} x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#6366f1">
          {animated ? (
            <animate
              attributeName="stop-color"
              values="#6366f1;#8b5cf6;#ec4899;#6366f1"
              dur="4s"
              repeatCount="indefinite"
            />
          ) : null}
        </stop>
        <stop offset="50%" stopColor="#8b5cf6">
          {animated ? (
            <animate
              attributeName="stop-color"
              values="#8b5cf6;#ec4899;#06b6d4;#8b5cf6"
              dur="4s"
              repeatCount="indefinite"
            />
          ) : null}
        </stop>
        <stop offset="100%" stopColor="#ec4899">
          {animated ? (
            <animate
              attributeName="stop-color"
              values="#ec4899;#06b6d4;#6366f1;#ec4899"
              dur="4s"
              repeatCount="indefinite"
            />
          ) : null}
        </stop>
      </linearGradient>
      <filter id={ids.glow}>
        <feGaussianBlur stdDeviation="3" result="coloredBlur" />
        <feMerge>
          <feMergeNode in="coloredBlur" />
          <feMergeNode in="SourceGraphic" />
        </feMerge>
      </filter>
    </defs>
  );
}

function DefaultMark({ ids }: { ids: LogoIds }) {
  return (
    <>
      <g transform="translate(100, 100)">
        <path
          d="M -50 -60 L -50 10 Q -50 45 -15 45 L 15 45 Q 50 45 50 10 L 50 -60"
          stroke={`url(#${ids.grad1})`}
          strokeWidth="12"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g opacity="0.92">
          <rect
            x="-35"
            y="-25"
            width="25"
            height="32"
            rx="2"
            fill={`url(#${ids.grad2})`}
            transform="rotate(-12 -22.5 -9)"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="-12 -22.5 -9; -8 -22.5 -9; -12 -22.5 -9"
              dur="3s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="-30" y1="-18" x2="-15" y2="-20" stroke="white" strokeWidth="1.5" opacity="0.82" strokeLinecap="round" />
          <line x1="-31" y1="-12" x2="-16" y2="-14" stroke="white" strokeWidth="1.5" opacity="0.82" strokeLinecap="round" />
          <line x1="-32" y1="-6" x2="-17" y2="-8" stroke="white" strokeWidth="1.5" opacity="0.62" strokeLinecap="round" />
          <rect
            x="-12"
            y="-30"
            width="25"
            height="35"
            rx="2"
            fill={`url(#${ids.mainGrad})`}
            filter={`url(#${ids.glow})`}
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -3; 0 0"
              dur="2.5s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="-7" y1="-22" x2="8" y2="-22" stroke="white" strokeWidth="1.5" opacity="0.92" strokeLinecap="round" />
          <line x1="-7" y1="-15" x2="8" y2="-15" stroke="white" strokeWidth="1.5" opacity="0.92" strokeLinecap="round" />
          <line x1="-7" y1="-8" x2="4" y2="-8" stroke="white" strokeWidth="1.5" opacity="0.72" strokeLinecap="round" />
          <rect
            x="12"
            y="-23"
            width="25"
            height="30"
            rx="2"
            fill={`url(#${ids.grad3})`}
            transform="rotate(15 24.5 -8)"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="15 24.5 -8; 18 24.5 -8; 15 24.5 -8"
              dur="3.5s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="17" y1="-17" x2="32" y2="-14" stroke="white" strokeWidth="1.5" opacity="0.82" strokeLinecap="round" />
          <line x1="16" y1="-11" x2="31" y2="-8" stroke="white" strokeWidth="1.5" opacity="0.82" strokeLinecap="round" />
          <line x1="15" y1="-5" x2="28" y2="-2.5" stroke="white" strokeWidth="1.5" opacity="0.62" strokeLinecap="round" />
        </g>
        <circle cx="-40" cy="30" r="3" fill={`url(#${ids.grad1})`} opacity="0.7">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="0" cy="35" r="3" fill={`url(#${ids.mainGrad})`} opacity="0.7">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" begin="0.5s" repeatCount="indefinite" />
        </circle>
        <circle cx="40" cy="30" r="3" fill={`url(#${ids.grad3})`} opacity="0.7">
          <animate attributeName="opacity" values="0.7;1;0.7" dur="2s" begin="1s" repeatCount="indefinite" />
        </circle>
        <line x1="-40" y1="30" x2="0" y2="35" stroke={`url(#${ids.grad2})`} strokeWidth="1" opacity="0.34" />
        <line x1="0" y1="35" x2="40" y2="30" stroke={`url(#${ids.grad2})`} strokeWidth="1" opacity="0.34" />
      </g>
      <g>
        <circle cx="100" cy="100" r="75" stroke={`url(#${ids.mainGrad})`} strokeWidth="0.5" opacity="0.22" fill="none" />
        <circle r="4" fill={`url(#${ids.grad2})`} opacity="0.84">
          <animateMotion
            dur="6s"
            repeatCount="indefinite"
            path="M 100,25 A 75,75 0 1,1 100,175 A 75,75 0 1,1 100,25"
          />
        </circle>
      </g>
    </>
  );
}

function MinimalMark({ ids }: { ids: LogoIds }) {
  return (
    <>
      <circle
        cx="100"
        cy="100"
        r="72"
        stroke={`url(#${ids.mainGrad})`}
        strokeWidth="0.85"
        opacity="0.22"
        fill="none"
      />
      <g>
        <animateTransform
          attributeName="transform"
          type="rotate"
          from="0 100 100"
          to="360 100 100"
          dur="6.5s"
          repeatCount="indefinite"
        />
        <circle cx="100" cy="28" r="4" fill={`url(#${ids.grad2})`} opacity="0.84" />
      </g>
      <g transform="translate(100, 100)">
        <path
          d="M -48 -56 L -48 8 Q -48 42 -14 42 L 14 42 Q 48 42 48 8 L 48 -56"
          stroke={`url(#${ids.grad1})`}
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <g opacity="0.95">
          <rect
            x="-34"
            y="-24"
            width="22"
            height="29"
            rx="2"
            fill={`url(#${ids.grad2})`}
            transform="rotate(-12 -23 -10)"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="-12 -23 -10; -9 -23 -10; -12 -23 -10"
              dur="3.2s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="-29" y1="-17" x2="-16" y2="-19" stroke="white" strokeWidth="1.4" opacity="0.82" strokeLinecap="round" />
          <line x1="-30" y1="-11" x2="-17" y2="-13" stroke="white" strokeWidth="1.4" opacity="0.82" strokeLinecap="round" />

          <rect
            x="-10"
            y="-29"
            width="22"
            height="32"
            rx="2"
            fill={`url(#${ids.mainGrad})`}
          >
            <animateTransform
              attributeName="transform"
              type="translate"
              values="0 0; 0 -2.5; 0 0"
              dur="2.6s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="-5" y1="-21" x2="7" y2="-21" stroke="white" strokeWidth="1.4" opacity="0.9" strokeLinecap="round" />
          <line x1="-5" y1="-14" x2="7" y2="-14" stroke="white" strokeWidth="1.4" opacity="0.9" strokeLinecap="round" />

          <rect
            x="13"
            y="-22"
            width="22"
            height="28"
            rx="2"
            fill={`url(#${ids.grad3})`}
            transform="rotate(14 24 -8)"
          >
            <animateTransform
              attributeName="transform"
              type="rotate"
              values="14 24 -8; 17 24 -8; 14 24 -8"
              dur="3.6s"
              repeatCount="indefinite"
            />
          </rect>
          <line x1="18" y1="-16" x2="31" y2="-13" stroke="white" strokeWidth="1.4" opacity="0.82" strokeLinecap="round" />
          <line x1="17" y1="-10" x2="30" y2="-7" stroke="white" strokeWidth="1.4" opacity="0.82" strokeLinecap="round" />
        </g>
        <circle cx="-28" cy="30" r="3.2" fill={`url(#${ids.grad2})`} opacity="0.72">
          <animate attributeName="opacity" values="0.72;1;0.72" dur="2s" repeatCount="indefinite" />
        </circle>
        <circle cx="0" cy="36" r="3.2" fill={`url(#${ids.mainGrad})`} opacity="0.78">
          <animate attributeName="opacity" values="0.78;1;0.78" dur="2s" begin="0.45s" repeatCount="indefinite" />
        </circle>
        <circle cx="28" cy="30" r="3.2" fill={`url(#${ids.grad3})`} opacity="0.72">
          <animate attributeName="opacity" values="0.72;1;0.72" dur="2s" begin="0.9s" repeatCount="indefinite" />
        </circle>
        <line x1="-28" y1="30" x2="0" y2="36" stroke={`url(#${ids.grad2})`} strokeWidth="1.2" opacity="0.34" />
        <line x1="0" y1="36" x2="28" y2="30" stroke={`url(#${ids.grad2})`} strokeWidth="1.2" opacity="0.34" />
      </g>
    </>
  );
}

function GeometricMark({ ids }: { ids: LogoIds }) {
  return (
    <>
      <g transform="translate(100, 100)">
        <path
          d="M -52 -56 V 8 C -52 40 -31 56 0 56 C 31 56 52 40 52 8 V -56"
          stroke={`url(#${ids.grad1})`}
          strokeWidth="11"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path d="M -30 -18 L -12 -28 L 2 -4 L -16 6 Z" fill={`url(#${ids.grad2})`} opacity="0.92" />
        <path d="M -2 -30 L 18 -30 L 18 -6 L -2 -6 Z" fill={`url(#${ids.mainGrad})`} opacity="0.95" />
        <path d="M 18 -2 L 38 -14 L 48 8 L 28 20 Z" fill={`url(#${ids.grad3})`} opacity="0.92" />
        <circle cx="-30" cy="28" r="4" fill={`url(#${ids.grad2})`} opacity="0.7" />
        <circle cx="0" cy="36" r="4" fill={`url(#${ids.mainGrad})`} opacity="0.76" />
        <circle cx="30" cy="28" r="4" fill={`url(#${ids.grad3})`} opacity="0.72" />
        <line x1="-30" y1="28" x2="0" y2="36" stroke={`url(#${ids.grad2})`} strokeWidth="1.3" opacity="0.35" />
        <line x1="0" y1="36" x2="30" y2="28" stroke={`url(#${ids.grad2})`} strokeWidth="1.3" opacity="0.35" />
      </g>
      <circle cx="100" cy="100" r="74" stroke={`url(#${ids.mainGrad})`} strokeWidth="0.75" opacity="0.18" fill="none" />
    </>
  );
}

export function UnipubLogo({
  size = 200,
  className = "",
  showText = true,
  variant = "default",
}: UnipubLogoProps) {
  const uniqueSeed = useId().replace(/:/g, "");
  const ids = buildLogoIds(uniqueSeed);
  const textSize = Math.max(24, Math.round(size * 0.3));
  const subtitleSize = Math.max(10, Math.round(size * 0.07));
  const wrapperClassName = ["unipub-logo", showText ? "unipub-logo-with-text" : "", className]
    .filter(Boolean)
    .join(" ");

  let mark = <DefaultMark ids={ids} />;
  if (variant === "minimal") mark = <MinimalMark ids={ids} />;
  if (variant === "geometric") mark = <GeometricMark ids={ids} />;

  return (
    <div className={wrapperClassName}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="unipub-logo-mark"
        role="img"
        aria-label="UniPub logo"
      >
        <LogoDefs ids={ids} animated={variant === "default"} />
        {mark}
      </svg>
      {showText ? (
        <div className="unipub-logo-textblock">
          <div className="unipub-logo-wordmark" style={{ fontSize: `${textSize}px` }}>
            <span className="unipub-logo-wordmark-uni">uni</span>
            <span className="unipub-logo-wordmark-pub">pub</span>
          </div>
          <div className="unipub-logo-subtitle" style={{ fontSize: `${subtitleSize}px` }}>
            Academic Research Hub
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default UnipubLogo;
