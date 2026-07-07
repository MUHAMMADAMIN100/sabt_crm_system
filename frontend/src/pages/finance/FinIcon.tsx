// Минималистичные 2D line-иконки. Один стиль: stroke=currentColor, 24-сетка,
// скруглённые концы. Наследуют цвет текста (и цвет группы через style.color).
import type { CSSProperties, ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  // навигация
  overview: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10" /></>,
  income: <><polyline points="3 17 9 11 13 15 21 7" /><polyline points="15 7 21 7 21 13" /></>,
  expense: <><polyline points="3 7 9 13 13 9 21 17" /><polyline points="15 17 21 17 21 11" /></>,
  transactions: <><path d="M17 4l4 4-4 4" /><path d="M21 8H3" /><path d="M7 20l-4-4 4-4" /><path d="M3 16h18" /></>,
  settings: <><line x1="4" y1="7" x2="20" y2="7" /><circle cx="9" cy="7" r="2" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="15" cy="17" r="2" /></>,
  currency: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  // направления дохода
  smm: <><path d="M3 10v4h4l6 4V6L7 10H3z" /><path d="M17 9a4 4 0 0 1 0 6" /></>,
  development: <><polyline points="8 7 3 12 8 17" /><polyline points="16 7 21 12 16 17" /></>,
  design: <><circle cx="12" cy="12" r="8.5" /><circle cx="9" cy="9" r="1" /><circle cx="15" cy="9" r="1" /><circle cx="9.5" cy="14.5" r="1" /><path d="M12 12c2 0 3 1.2 3 3a3 3 0 0 0 0-6" /></>,
  // части расхода
  salary: <><circle cx="9" cy="8" r="3" /><path d="M3.5 19a5.5 5.5 0 0 1 11 0" /><path d="M16 6a3 3 0 0 1 0 6" /><path d="M17 13.5a5.5 5.5 0 0 1 3.5 5.5" /></>,
  building: <><rect x="5" y="3" width="14" height="18" rx="1.5" /><line x1="9" y1="7" x2="9" y2="7" /><line x1="15" y1="7" x2="15" y2="7" /><line x1="9" y1="11" x2="9" y2="11" /><line x1="15" y1="11" x2="15" y2="11" /><path d="M10 21v-4h4v4" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" /><line x1="9" y1="8" x2="15" y2="8" /><line x1="9" y1="12" x2="15" y2="12" /></>,
  // действия
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  close: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  undo: <><polyline points="9 14 4 9 9 4" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></>,
  download: <><path d="M12 3v12" /><polyline points="7 10 12 15 17 10" /><path d="M5 21h14" /></>,
  upload: <><path d="M12 21V9" /><polyline points="7 8 12 3 17 8" /><path d="M5 21h14" /></>,
  arrowRight: <><line x1="5" y1="12" x2="19" y2="12" /><polyline points="13 6 19 12 13 18" /></>,
  chevronLeft: <polyline points="15 6 9 12 15 18" />,
  chevronRight: <polyline points="9 6 15 12 9 18" />,
  // категории
  car: <><path d="M3 13l2-5a2 2 0 0 1 1.9-1.3h10.2A2 2 0 0 1 19 8l2 5v5a1 1 0 0 1-1 1h-1a1 1 0 0 1-1-1v-1H6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" /><circle cx="7.5" cy="14.5" r="1" /><circle cx="16.5" cy="14.5" r="1" /><path d="M3 13h18" /></>,
  printer: <><path d="M6 9V3h12v6" /><rect x="4" y="9" width="16" height="8" rx="2" /><path d="M8 17h8v4H8z" /><circle cx="17" cy="12.5" r="0.6" /></>,
  percent: <><line x1="6" y1="18" x2="18" y2="6" /><circle cx="7.5" cy="7.5" r="2" /><circle cx="16.5" cy="16.5" r="2" /></>,
  target: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><circle cx="12" cy="12" r="1" /></>,
  dots: <><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>,
  // пустые состояния / статусы
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><polyline points="8.5 12 11 14.5 16 9" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 9h18" /><circle cx="16.5" cy="13" r="1.2" /></>,
};

export default function FinIcon({ name, size = 18, className, style }: {
  name: string; size?: number; className?: string; style?: CSSProperties;
}) {
  const d = PATHS[name];
  if (!d) return null;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"
      className={className} style={{ flexShrink: 0, ...style }} aria-hidden
    >
      {d}
    </svg>
  );
}

/** Плоская 2D-плитка категории: белая иконка на цветном скруглённом фоне.
 *  color — цвет категории (fallback серый), icon — имя из PATHS. */
export function CatIcon({ icon, color, size = 26 }: {
  icon?: string | null; color?: string | null; size?: number;
}) {
  return (
    <span
      className="cat-ico"
      style={{ width: size, height: size, minWidth: size, background: color || '#94a3b8' }}
    >
      <FinIcon name={icon || 'dots'} size={Math.round(size * 0.58)} />
    </span>
  );
}
