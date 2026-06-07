import type { ReactNode } from 'react';
import { Box } from 'folds';

type SidebarContentProps = {
  scrollable: ReactNode;
  sticky: ReactNode;
};
export function SidebarContent({ scrollable, sticky }: SidebarContentProps) {
  return (
    <>
      <Box className="Scrollable-section" direction="Column" grow="Yes">
        {scrollable}
      </Box>
      <Box className="Sticky-section" direction="Column" shrink="No">
        {sticky}
      </Box>
    </>
  );
}
