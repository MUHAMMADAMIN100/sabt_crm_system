// Минималистичные 2D line-иконки. Один стиль: stroke=currentColor, 24-сетка,
// скруглённые концы. Наследуют цвет текста (и цвет группы через style.color).
import type { CSSProperties, ReactNode } from 'react'

const PATHS: Record<string, ReactNode> = {
  // навигация
  overview: <><rect x="3" y="3" width="7" height="7" rx="2" /><rect x="14" y="3" width="7" height="7" rx="2" /><rect x="3" y="14" width="7" height="7" rx="2" /><rect x="14" y="14" width="7" height="7" rx="2" /></>,
  income: <><circle cx="8" cy="8" r="4.5" /><path d="M8 5.7v4.6M6.7 7h2a1.1 1.1 0 0 1 0 2.2H7" /><path d="M12 17h8M17 14l3 3-3 3" /></>,
  expense: <><path d="M4 7h16v12H4z" /><path d="M4 10h16" /><path d="M8 15h3" /><path d="M18 3v5M15.5 5.5 18 8l2.5-2.5" /></>,
  transactions: <><path d="M4 7h15" /><path d="m16 4 3 3-3 3" /><path d="M20 17H5" /><path d="m8 14-3 3 3 3" /></>,
  settings: <><path d="M4 6h10" /><path d="M18 6h2" /><circle cx="16" cy="6" r="2" /><path d="M4 12h2" /><path d="M10 12h10" /><circle cx="8" cy="12" r="2" /><path d="M4 18h8" /><path d="M16 18h4" /><circle cx="14" cy="18" r="2" /></>,
  currency: <><ellipse cx="12" cy="7" rx="7" ry="3" /><path d="M5 7v5c0 1.7 3.1 3 7 3s7-1.3 7-3V7" /><path d="M5 12v5c0 1.7 3.1 3 7 3s7-1.3 7-3v-5" /></>,
  // направления дохода
  smm: <><path d="M4 11v3h4l7 4V7l-7 4H4z" /><path d="M8 14v4a2 2 0 0 0 3.6 1.2" /><path d="M18 9a4 4 0 0 1 0 7" /><path d="M20.5 6.5a7.5 7.5 0 0 1 0 12" /></>,
  development: <><path d="m8 8-4 4 4 4" /><path d="m16 8 4 4-4 4" /><path d="m14 5-4 14" /></>,
  design: <><path d="m4 20 4.5-1 10-10a2.5 2.5 0 0 0-3.5-3.5l-10 10L4 20z" /><path d="m13.5 7 3.5 3.5" /><path d="M4 20h5" /></>,
  maintenance: <><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" /><path d="M15.5 7.5a3 3 0 0 0-3.7 3.7L8 15" /><path d="m14.2 9.8 2.3-2.3" /></>,
  // части расхода
  salary: <><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M7 10v4M17 10v4" /></>,
  building: <><path d="M4 21V5l8-3 8 3v16" /><path d="M9 21v-4h6v4" /><path d="M8 8h1M15 8h1M8 12h1M15 12h1" /></>,
  receipt: <><path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3z" /><path d="M9 8h6M9 12h6M9 16h3" /></>,
  // действия
  plus: <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>,
  close: <><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M6 6l1 14h10l1-14" /></>,
  archive: <><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8" /><line x1="10" y1="12" x2="14" y2="12" /></>,
  check: <polyline points="20 6 9 17 4 12" />,
  undo: <><polyline points="9 14 4 9 9 4" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>,
  pause: <><line x1="9" y1="5" x2="9" y2="19" /><line x1="15" y1="5" x2="15" y2="19" /></>,
  play: <path d="M8 5.5v13l11-6.5z" />,
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
  // новые иконки категорий (стиль референса: сетка 24, скруглённые концы)
  banknote: <><rect x="2.5" y="6.5" width="19" height="11" rx="2" /><circle cx="12" cy="12" r="2.4" /><path d="M6 10.5v3" /><path d="M18 10.5v3" /></>,
  creditCard: <><rect x="2.5" y="5" width="19" height="14" rx="2.5" /><line x1="2.5" y1="9.5" x2="21.5" y2="9.5" /><line x1="6" y1="14" x2="10" y2="14" /></>,
  megaphone: <><path d="M4 10v4h3l9 4V6L7 10H4z" /><path d="M7 14v3a1.8 1.8 0 0 0 3.2 1.1" /><path d="M18.5 9.5a3.5 3.5 0 0 1 0 5" /></>,
  box: <><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5" /><path d="M12 12v9" /></>,
  piggy: <><path d="M4 12a6 5 0 0 1 6-5h3a6 5 0 0 1 6 5v1a6 5 0 0 1-2 3.6V19h-3v-1.5h-2V19H9v-1.5a6 5 0 0 1-2-3.6H5a1 1 0 0 1-1-1z" /><circle cx="9" cy="11.5" r="0.8" /><path d="M13 7c0-1.5 1.5-2.5 3-2" /></>,
  megaphone2: <><path d="M3 11l14-6v14L3 13z" /><path d="M7 13v3.5a1.5 1.5 0 0 0 3 .4" /></>,
  shield: <><path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6l7-3z" /><polyline points="9 12 11 14 15 10" /></>,
  split: <><path d="M4 6h4l5 6H4" /><path d="M4 18h4l5-6" /><polyline points="16 8 20 8 20 4" /><line x1="13" y1="12" x2="20" y2="8" /><polyline points="16 16 20 16 20 20" /><line x1="13" y1="12" x2="20" y2="16" /></>,
  // пустые состояния / статусы
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  checkCircle: <><circle cx="12" cy="12" r="9" /><polyline points="8.5 12 11 14.5 16 9" /></>,
  wallet: <><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 9h18" /><circle cx="16.5" cy="13" r="1.2" /></>,
};

/** Иконки, доступные для выбора у категории (в настройках). */
export const PICKER_ICONS = [
  'banknote', 'currency', 'piggy', 'creditCard', 'wallet', 'percent', 'receipt',
  'megaphone', 'smm', 'development', 'design', 'maintenance', 'target', 'building', 'car', 'printer',
  'box', 'shield', 'split', 'transactions', 'income', 'expense', 'undo', 'dots',
] as const;

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
