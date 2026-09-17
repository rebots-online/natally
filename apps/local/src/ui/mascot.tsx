import idleLoop from "../assets/mascot/natally-idle-400.webp";
import frameZero from "../assets/mascot/natally-still-400.png";

export interface MascotProps {
  size?: number;
  className?: string;
  alt?: string;
}

/** Approved brand animation. Companion expressions belong to the event-driven Stage. */
export function Mascot({ size = 160, className, alt = "" }: MascotProps) {
  return (
    <picture className={className}>
      <source media="(prefers-reduced-motion: reduce)" srcSet={frameZero} />
      <img
        src={idleLoop}
        width={size}
        height={size}
        alt={alt}
        draggable={false}
        style={{ display: "block", maxWidth: "100%", height: "auto", borderRadius: "50%" }}
      />
    </picture>
  );
}
