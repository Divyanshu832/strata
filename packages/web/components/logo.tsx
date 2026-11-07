/** Three offset layers: the strata mark. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 7.5 Q8 5.5 12 7 T21 6.5 V9.5 Q16 10.5 12 9.5 T3 10.5Z" fill="var(--t-place)" />
      <path d="M3 12 Q8 10.5 12 12 T21 11.5 V14.5 Q16 15.5 12 14.5 T3 15Z" fill="var(--ochre)" />
      <path d="M3 16.5 Q8 15 12 16.5 T21 16 V19 Q16 20 12 19 T3 19.5Z" fill="var(--t-person)" opacity="0.85" />
    </svg>
  );
}
