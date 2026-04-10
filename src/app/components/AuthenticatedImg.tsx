/* eslint-disable jsx-a11y/alt-text */
import { useMediaSrc } from '$hooks/useMediaSrc';
import { getSafeMediaUrl } from '$utils/sanitize';

type AuthenticatedImgProps = React.ImgHTMLAttributes<HTMLImageElement> & {
  src: string;
};

export function AuthenticatedImg({ src, ...props }: AuthenticatedImgProps) {
  const resolvedSrc = useMediaSrc(src);
  const safeSrc = getSafeMediaUrl(resolvedSrc ?? src);

  if (!safeSrc) return null;

  return <img {...props} src={safeSrc} />;
}
