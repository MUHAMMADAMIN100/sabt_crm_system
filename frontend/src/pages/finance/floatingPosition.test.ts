import { describe, expect, it } from 'vitest';
import { floatingPosition } from './floatingPosition';

describe('floatingPosition', () => {
  it('places a popover below when enough space exists', () => {
    expect(floatingPosition(
      { top: 100, right: 320, bottom: 140, left: 120 },
      380, 420, 1200, 900,
    )).toEqual({ top: 148, left: 120, above: false });
  });

  it('anchors an upper popover by bottom without transform', () => {
    const result = floatingPosition(
      { top: 700, right: 600, bottom: 740, left: 220 },
      380, 420, 1200, 900,
    );
    expect(result).toEqual({ bottom: 208, left: 220, above: true });
    expect(result.top).toBeUndefined();
  });

  it('keeps the popover inside narrow viewport edges', () => {
    expect(floatingPosition(
      { top: 80, right: 390, bottom: 120, left: 350 },
      380, 240, 400, 800,
    ).left).toBe(12);
  });
});
