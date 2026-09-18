import { BEHAVIOR_NOTES, type IdleBehavior } from "./mascot-behaviors.js";

/**
 * §18.2 authored sprite vignettes: gold-hairline silhouette marks projected
 * over the real-footage idle core. Every mark is hand-authored vector work at
 * the same 400×400 geometry as the state overlays; no AI-generated art. Motion
 * is a prop, never read here — the Stage owns the reduced-motion/visibility
 * decision (U.9 law), and a still vignette is simply frame zero.
 */

const GOLD = "#d7b978";
const LILAC = "#b7a3ef";
/** Determinatic wheel tick positions (degrees); a fixed authored array. */
const WHEEL_TICK_DEGREES = Object.freeze([0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330]);

export function IdleBehaviorVignette({
  behavior,
  motion,
}: {
  behavior: IdleBehavior;
  motion: boolean;
}) {
  const drift = motion ? "natally-behavior-drift 9s ease-in-out infinite" : "none";
  return (
    <g
      data-idle-behavior={behavior}
      stroke={GOLD}
      strokeWidth="2.5"
      strokeLinecap="round"
      fill="none"
    >
      {/* A hidden title keeps the authored behaviour name inspectable for tests/a11y tooling. */}
      <title>{`natally behaviour: ${BEHAVIOR_NOTES[behavior]}`}</title>
      {behavior === "lounge" && (
        <g style={{ animation: drift }}>
          {/* Arms-up sprawl draped over the composer edge. */}
          <path d="M96 348 Q140 322 178 344 M222 344 Q262 322 306 348" />
          <path d="M110 366 H290" strokeDasharray="1 7" />
          <path d="M150 338 Q158 330 166 338 M240 338 Q248 330 256 338" />
        </g>
      )}
      {behavior === "wheel-stand" && (
        <g style={{ animation: drift }}>
          {/* A natal-chart wheel behind the gold circle: 12 house ticks on an arc. */}
          <circle cx="200" cy="196" r="118" strokeDasharray="2 6" />
          <circle cx="200" cy="196" r="96" opacity="0.6" />
          {WHEEL_TICK_DEGREES.map((degree) => {
            const angle = (degree - 90) * (Math.PI / 180);
            const x1 = 200 + 96 * Math.cos(angle);
            const y1 = 196 + 96 * Math.sin(angle);
            const x2 = 200 + 118 * Math.cos(angle);
            const y2 = 196 + 118 * Math.sin(angle);
            return <line key={`wheel-${degree}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
        </g>
      )}
      {behavior === "tend" && (
        <g
          style={{
            animation: motion ? "natally-behavior-sparkle 4s ease-in-out infinite" : "none",
          }}
        >
          {/* Tending the crystal ball: polish arc + rising sparkles. */}
          <path d="M164 306 Q203 322 242 306" />
          <path
            d="M170 272 l4 10 10 4 -10 4 -4 10 -4 -10 -10 -4 10 -4 Z"
            fill={GOLD}
            fillOpacity="0.25"
          />
          <path d="M232 260 l3 8 8 3 -8 3 -3 8 -3 -8 -8 -3 8 -3 Z" fill={GOLD} fillOpacity="0.2" />
          <path d="M203 244 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 Z" fill={GOLD} fillOpacity="0.15" />
        </g>
      )}
      {behavior === "doom-scroll" && (
        <g style={{ animation: drift }}>
          {/* The phone: doom-scroll lines + a thumb. */}
          <rect x="252" y="228" width="38" height="66" rx="7" />
          <path
            d="M259 240 H283 M259 250 H283 M259 260 H277 M259 270 H283 M259 280 H271"
            strokeWidth="2"
            opacity="0.8"
          />
          <circle cx="271" cy="292" r="5" opacity="0.7" />
        </g>
      )}
      {behavior === "attention" && (
        <g
          style={{
            animation: motion ? "natally-behavior-knock 2.4s ease-in-out infinite" : "none",
          }}
        >
          {/* Bang on the glass: radial attention marks at the porthole edge. */}
          <path d="M64 132 l-16 -12 M58 168 l-20 -2 M70 104 l-12 -16" />
          <path d="M330 236 l18 8 M326 264 l20 4" opacity="0.6" />
        </g>
      )}
      {behavior === "dawn-yawn" && (
        <g style={{ animation: drift }}>
          {/* Dawn mirroring: z-z glyphs and a groggy coffee with steam. */}
          <path d="M286 150 h14 l-14 14 h14" strokeWidth="2.5" />
          <path d="M304 124 h10 l-10 10 h10" strokeWidth="2" opacity="0.75" />
          <g transform="translate(96 268)">
            <path d="M0 22 H30 V8 a4 4 0 0 1 4 -4 h2 a4 4 0 0 1 0 8" />
            <path d="M4 30 H26" />
            <path
              d="M10 -2 q3 -6 0 -12 M20 -2 q3 -6 0 -12"
              stroke={LILAC}
              strokeWidth="1.5"
              opacity="0.7"
            />
          </g>
        </g>
      )}
      {behavior === "cursor-ride" && (
        <g style={{ animation: motion ? "natally-behavior-ride 5s ease-in-out infinite" : "none" }}>
          {/* Cursor-grab/ride: the pointer arrow with grab lines. */}
          <path d="M300 210 l0 26 7 -6 5 11 6 -3 -5 -11 9 -1 Z" fill={GOLD} fillOpacity="0.3" />
          <path d="M268 246 Q280 258 296 250" strokeDasharray="2 5" />
        </g>
      )}
      {behavior === "finger-pounce" && (
        <g
          style={{
            animation: motion ? "natally-behavior-pounce 3.2s ease-in-out infinite" : "none",
          }}
        >
          {/* Finger-pounce: a fingertip meeting paw arcs. */}
          <circle cx="203" cy="352" r="9" />
          <path d="M176 330 Q186 342 200 344 M230 330 Q220 342 206 344" strokeDasharray="3 5" />
        </g>
      )}
    </g>
  );
}
