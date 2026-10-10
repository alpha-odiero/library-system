import type { ReactNode } from 'react';
import darkLogo from '../../assets/dark.webp';
import lightLogo from '../../assets/light.webp';
import { useTheme } from '../../contexts/ThemeContext';

export function Brand({ compact = false }: { compact?: boolean }): ReactNode {
  const { theme } = useTheme();

  return (
    <span className={['brand', compact && 'brand--compact'].filter(Boolean).join(' ')}>
      <span className="brand__mark" aria-hidden="true">
        <img className="brand__logo" src={theme === 'dark' ? darkLogo : lightLogo} alt="" />
      </span>
      <span className="brand__copy">
        <span className="brand__name">Soma360</span>
        {!compact && <span className="brand__tagline">Smarter Libraries. Brighter Futures.</span>}
      </span>
    </span>
  );
}
