/**
 * Drawn icons, not a font and not emoji. Every path is on a 24-unit grid at a
 * single hairline weight, so an icon sits on the same rule as the type does.
 */

export const ICON_PATHS = {
  home: 'M4 11 12 4l8 7M6 10v10h12V10M10 20v-6h4v6',
  queue: 'M4 6h11M4 12h11M4 18h7M19 15v6M16 18h6',
  library: 'M4 4h4v16H4zM10 4h3v16h-3zM15.5 5l3.5 1-3.5 14-2-.6z',
  ranks: 'M4 20h4V9H4zM10 20h4V4h-4zM16 20h4v-7h-4z',
  timeline: 'M4 12h16M8 12a2 2 0 104 0 2 2 0 10-4 0M4 6h5M15 18h5',
  lens: 'M11 4a7 7 0 100 14 7 7 0 100-14M11 8v6M8 11h6',
  settings: 'M4 7h16M4 12h16M4 17h16M9 5v4M16 10v4M7 15v4',
  health: 'M3 12h4l2-5 3 10 2-5h7',
  menu: 'M4 7h16M4 12h16M4 17h16',
  search: 'M10.5 4a6.5 6.5 0 100 13 6.5 6.5 0 100-13M15.5 15.5L21 21',
  'arrow-left': 'M20 12H4M10 6l-6 6 6 6',
  'arrow-right': 'M4 12h16M14 6l6 6-6 6',
  'arrow-up': 'M12 20V4M6 10l6-6 6 6',
  'arrow-down': 'M12 4v16M6 14l6 6 6-6',
  check: 'M4 12.5L9 18 20 6',
  close: 'M5 5l14 14M19 5L5 19',
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  undo: 'M4 9h11a5 5 0 010 10h-6M4 9l4-4M4 9l4 4',
  clock: 'M12 4a8 8 0 100 16 8 8 0 100-16M12 7v5l3 2',
  link: 'M10 14a4 4 0 006 0l3-3a4 4 0 10-6-6l-1 1M14 10a4 4 0 00-6 0l-3 3a4 4 0 106 6l1-1',
  cloud: 'M7 18h10a4 4 0 000-8 6 6 0 00-11.7 1.6A3.5 3.5 0 007 18',
  'cloud-off': 'M7 18h10a4 4 0 001.5-7.7M5.6 8.6A3.5 3.5 0 007 18M4 4l16 16',
  offline: 'M2 8.5a15 15 0 0120 0M5.5 12a10 10 0 0113 0M9 15.5a5 5 0 016 0M12 19h.01M3 3l18 18',
  star: 'M12 4l2.4 5.2 5.6.7-4.1 3.9 1.1 5.6-5-2.9-5 2.9 1.1-5.6L4 9.9l5.6-.7z',
  flag: 'M6 21V4h12l-2.5 4L18 12H6',
  note: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  chevron: 'M9 5l7 7-7 7',
  download: 'M12 4v11M7 11l5 5 5-5M4 20h16',
  upload: 'M12 20V9M7 13l5-5 5 5M4 4h16',
  refresh: 'M20 6v5h-5M4 18v-5h5M19 11a7 7 0 00-12.3-3.5M5 13a7 7 0 0012.3 3.5',
  versus: 'M3 5h7v14H3zM14 5h7v14h-7zM12 9v6',
  pin: 'M9 3h6l-1 6 4 4H6l4-4z M12 13v8',
  'thumb-up': 'M3 11H7V21H3ZM7 11L10.5 3H12L13 5L12 9H18L19.5 11L17.7 21H7Z',
  'thumb-down': 'M3 3H7V13H3ZM7 13L10.5 21H12L13 19L12 15H18L19.5 13L17.7 3H7Z',
} as const;

export type IconName = keyof typeof ICON_PATHS;
