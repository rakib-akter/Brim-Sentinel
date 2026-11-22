/** Brim Sentinel mark: a watchful ring with a settled check — not an official Brim asset. */
export function BrandMark({ className = "size-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-primary" />
      <circle
        cx="16"
        cy="16"
        r="8.5"
        fill="none"
        strokeWidth="2"
        className="stroke-primary-foreground/35"
      />
      <path
        d="M16 7.5a8.5 8.5 0 0 1 8.5 8.5"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-primary-foreground"
      />
      <path
        d="m12.2 16.3 2.6 2.6 5-5.2"
        fill="none"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="stroke-primary-foreground"
      />
    </svg>
  );
}
