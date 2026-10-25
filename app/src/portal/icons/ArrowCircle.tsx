// A small circled-arrow glyph, tucked on the right of primary pill buttons
// (the Vanta CTA affordance). Hand-rolled to avoid an icon dependency.

export function ArrowCircle({ className = '', size = 18 }: { className?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      fill="none"
    >
      <circle cx="10" cy="10" r="9" stroke="currentColor" strokeWidth="1.25" opacity="0.4" />
      <path
        d="M7 10h6M10 7l3 3-3 3"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
