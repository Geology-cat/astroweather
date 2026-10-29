// 線画アイコン（24×24、currentColor）。絵文字の代わりに使い、見た目のトーンを揃える。
import type { ReactNode } from 'react';

const PATHS = {
  sun: 'M12 8.2a3.8 3.8 0 1 0 0 7.6 3.8 3.8 0 0 0 0-7.6zM12 2.5v2.2M12 19.3v2.2M4.6 4.6l1.6 1.6M17.8 17.8l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.6 19.4l1.6-1.6M17.8 6.2l1.6-1.6',
  moon: 'M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z',
  twilight: 'M2.5 18.5h19M6.5 18.5a5.5 5.5 0 0 1 11 0M12 3.5v4M9.6 5.6 12 3.2l2.4 2.4M4.2 11.6l1.6 1M19.8 11.6l-1.6 1',
  stars: 'M10 3.5l1.7 4.8 4.8 1.7-4.8 1.7L10 16.5l-1.7-4.8L3.5 10l4.8-1.7zM18 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
  gauge: 'M3.5 16.5a8.5 8.5 0 1 1 17 0M12 16.5l4.2-5.2M6.6 12.2l-1.2-.7M8.8 9l-.7-1.2M12 8V6.6M17.4 12.2l1.2-.7',
  pin: 'M12 21.2s-6.5-5.7-6.5-11.2a6.5 6.5 0 0 1 13 0c0 5.5-6.5 11.2-6.5 11.2zM12 7.7a2.3 2.3 0 1 0 0 4.6 2.3 2.3 0 0 0 0-4.6z',
  ranking: 'M4 6.5h9M4 12h16M4 17.5h6.5',
  chart: 'M3.5 19.5h17M4.5 15l4.5-5.5 4 3.5 6.5-7.5',
  cloud: 'M7.2 18.5h9.8a4.2 4.2 0 0 0 .6-8.36A6.1 6.1 0 0 0 5.9 9.4a4.6 4.6 0 0 0 1.3 9.1z',
  search: 'M10.8 4.5a6.3 6.3 0 1 0 0 12.6 6.3 6.3 0 0 0 0-12.6zM20 20l-4.7-4.7',
  compass: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM15.2 8.8l-1.7 4.7-4.7 1.7 1.7-4.7z',
  locate: 'M3.5 11.2 20.5 3.5 12.8 20.5l-1.9-7.4z',
  chevronLeft: 'M14.5 6l-6 6 6 6',
  chevronRight: 'M9.5 6l6 6-6 6',
  close: 'M6.5 6.5l11 11M17.5 6.5l-11 11',
  plus: 'M12 5.5v13M5.5 12h13',
  target: 'M12 3.5a8.5 8.5 0 1 0 0 17 8.5 8.5 0 0 0 0-17zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 1.8v3M12 19.2v3M1.8 12h3M19.2 12h3',
  layers: 'M12 3.5l8.5 4.5-8.5 4.5L3.5 8zM3.5 12.2 12 16.7l8.5-4.5M3.5 16.2 12 20.7l8.5-4.5',
  upload: 'M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 14.5v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4',
  book: 'M4.5 5.5A1.5 1.5 0 0 1 6 4h4.5a2 2 0 0 1 1.5.7 2 2 0 0 1 1.5-.7H18a1.5 1.5 0 0 1 1.5 1.5v12A1.5 1.5 0 0 1 18 19h-4.5a1.5 1.5 0 0 0-1.5 1.5A1.5 1.5 0 0 0 10.5 19H6a1.5 1.5 0 0 1-1.5-1.5zM12 6v14',
  download: 'M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 14.5v4a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-4',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className ? `icon ${className}` : 'icon'}
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** カード見出し（色付きアイコンタイル＋タイトル） */
export function CardTitle({
  icon,
  tone,
  children,
  as: Tag = 'h2',
}: {
  icon: IconName;
  tone: string;
  children: ReactNode;
  as?: 'h2' | 'h3';
}) {
  return (
    <Tag className={`card-title tone-${tone}`}>
      <span className="title-icon">
        <Icon name={icon} size={16} />
      </span>
      <span className="title-text">{children}</span>
    </Tag>
  );
}
