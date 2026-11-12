type BrandMarkProps = {
  size?: number;
  compact?: boolean;
  className?: string;
  title?: string;
};

/** C «Узел»: хост — акцентный круг, гости — currentColor. compact — упрощённый знак для 16–32 px. */
export function BrandMark({
  size = 24,
  compact,
  className,
  title,
}: BrandMarkProps) {
  const small = compact ?? size <= 32;
  if (small) {
    return (
      <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 16 16"
        aria-hidden={title ? undefined : true}
        role={title ? "img" : undefined}
      >
        {title && <title>{title}</title>}
        <path
          d="M5.5 4.5L3.5 12.5L12.5 11.5Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <circle cx="3.5" cy="12.5" r="2.5" fill="currentColor" />
        <circle cx="12.5" cy="11.5" r="2.5" fill="currentColor" />
        <circle cx="5.5" cy="4.5" r="3.5" fill="var(--accent)" />
      </svg>
    );
  }
  const height = Math.round((size * 56.4) / 49.4);
  return (
    <svg
      className={className}
      width={size}
      height={height}
      viewBox="8 1.5625 49.375 56.375"
      aria-hidden={title ? undefined : true}
      role={title ? "img" : undefined}
    >
      {title && <title>{title}</title>}
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        <path d="M23 24L44 41M23 24L20 47M44 41L20 47" strokeWidth="5" />
        <path d="M35.6 17.6L41.4 14.6" strokeWidth="3.4" strokeDasharray="0.01 5" />
      </g>
      <circle cx="20" cy="47" r="7" fill="currentColor" />
      <circle cx="44" cy="41" r="7" fill="currentColor" />
      <circle cx="47.5" cy="11.5" r="4.4" fill="none" stroke="currentColor" strokeWidth="3" />
      <circle cx="23" cy="24" r="11" fill="var(--accent)" />
    </svg>
  );
}
