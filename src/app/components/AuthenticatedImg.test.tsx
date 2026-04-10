import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AuthenticatedImg } from './AuthenticatedImg';

vi.mock('$hooks/useMediaSrc', () => ({
  useMediaSrc: () => undefined,
}));

describe('AuthenticatedImg', () => {
  it('drops unsafe image urls when media resolution does not provide a safe replacement', () => {
    const unsafeUrl = ['javascript', 'alert(1)'].join(':');
    const { container } = render(<AuthenticatedImg src={unsafeUrl} alt="unsafe media" />);

    expect(screen.queryByAltText('unsafe media')).not.toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });
});
