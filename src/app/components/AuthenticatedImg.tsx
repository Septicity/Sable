/* eslint-disable jsx-a11y/alt-text */
import { useMediaSrc } from '$hooks/useMediaSrc';
import { getSafeMediaUrl } from '$utils/sanitize';

type AuthenticatedImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

export function AuthenticatedImg({ src, ...props }: AuthenticatedImgProps) {
  const resolvedSrc = useMediaSrc(src);
  const candidateSrc = resolvedSrc ?? src;
  const safeSrc = getSafeMediaUrl(candidateSrc);

  if (!safeSrc) return null;

  try {
    const parsedSrc = new URL(safeSrc);

    if (
      parsedSrc.protocol !== 'blob:' &&
      parsedSrc.protocol !== 'http:' &&
      parsedSrc.protocol !== 'https:'
    ) {
      return null;
    }

    return <img {...props} src={parsedSrc.toString()} />;
  } catch {
    return null;
  }
}
