export type FloatingPosition = {
  top?: number;
  bottom?: number;
  left: number;
  above: boolean;
};

/** Позиция hover-окна относительно viewport.
 *
 * Для окна сверху используем `bottom`, а не `top + translateY(-100%)`.
 * Поэтому изменение высоты содержимого после загрузки не сдвигает край,
 * прилегающий к строке, и окно не «прыгает».
 */
export function floatingPosition(
  rect: Pick<DOMRect, 'top' | 'right' | 'bottom' | 'left'>,
  width: number,
  estimatedHeight: number,
  viewportWidth = window.innerWidth,
  viewportHeight = window.innerHeight,
  gap = 8,
): FloatingPosition {
  const safeWidth = Math.min(width, Math.max(0, viewportWidth - gap * 2));
  const roomAbove = Math.max(0, rect.top - gap);
  const roomBelow = Math.max(0, viewportHeight - rect.bottom - gap);
  const wantedHeight = Math.min(estimatedHeight, Math.max(0, viewportHeight - gap * 2));
  const above = roomBelow < wantedHeight && roomAbove > roomBelow;
  const left = Math.max(gap, Math.min(rect.left, viewportWidth - safeWidth - gap));

  return above
    ? { bottom: Math.max(gap, viewportHeight - rect.top + gap), left, above }
    : { top: Math.max(gap, Math.min(rect.bottom + gap, viewportHeight - gap)), left, above };
}
