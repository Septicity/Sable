import type { CSSProperties } from 'react';
import { Line, toRem } from 'folds';

type SidebarStackSeparatorProps = {
  className?: string;
  style?: CSSProperties;
};

export function SidebarStackSeparator({ className, style }: SidebarStackSeparatorProps) {
  return (
    <Line
      className={className ? `Separator ${className}` : 'Separator'}
      role="separator"
      style={{ width: toRem(24), margin: '0 auto', ...style }}
      variant="Background"
      size="300"
    />
  );
}
