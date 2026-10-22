/**
 * SkyGlass mark: a white mirror with two sky-blue bands
 * (docs/design/brand/logo-mark.svg, 64 × 92). Size it with CSS.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 64 92" aria-hidden="true">
      <path
        d="M11 2H53A9 9 0 0 1 62 11V81A9 9 0 0 1 53 90H11A9 9 0 0 1 2 81V11A9 9 0 0 1 11 2Z"
        fill="#FFFFFF"
      />
      <path d="M2 45L62 11V23L2 57Z" fill="var(--color-accent)" />
      <path d="M2 61L62 27V30L2 64Z" fill="var(--color-accent)" />
    </svg>
  );
}
