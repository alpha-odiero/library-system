import type { ReactNode } from 'react';
import libraryImage from '../../assets/sider.webp';

/**
 * The shared library artwork.
 *
 * One supplied image is reused on the landing page, dashboard welcome banner and
 * signed-out auth panel so each surface uses the same artwork.
 *
 * It is decorative because each call site already has a text heading.
 */
export function LibraryArt({ className }: { className?: string | undefined }): ReactNode {
  return (
    <img
      className={['library-art', className].filter(Boolean).join(' ')}
      src={libraryImage}
      alt=""
      aria-hidden="true"
    />
  );
}
