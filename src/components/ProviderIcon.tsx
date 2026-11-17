import type { ProviderIcon as IconData } from '@/lib/provider-icons';
import styles from './ProviderIcon.module.css';

interface Props {
  /** From `providerIconFor`; without one, `fallback` shows in a small square. */
  icon: IconData | undefined;
  fallback: string;
  /** Square size in px. */
  size?: number;
}

/** An engine's vendor icon drawn from path data (never markup); decorative. */
export function ProviderIcon({ icon, fallback, size = 15 }: Props) {
  if (!icon) {
    return (
      <span
        aria-hidden="true"
        className={styles.letter}
        style={{ minWidth: size, height: size, fontSize: Math.round(size * 0.6) }}
      >
        {fallback}
      </span>
    );
  }
  return (
    <svg
      aria-hidden="true"
      className={styles.icon}
      width={size}
      height={size}
      viewBox={icon.viewBox}
    >
      {icon.paths.map((path) => (
        <path
          key={path.d}
          d={path.d}
          fill={path.fill ?? 'currentColor'}
          fillOpacity={path.opacity}
          fillRule={path.evenOdd ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  );
}
