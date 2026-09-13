/** Copy dictionaries for the archived-session Settings page. */

/** Simplified Chinese dictionary and key source of truth. */
export const zh = {
  nav: '已归档会话',
  search: '搜索已归档会话',
  loading: '正在读取会话…',
  empty: '暂无已归档会话。',
  unavailable: '这里没有可恢复的已归档会话。',
  emptySearch: '没有匹配的会话。',
  unarchive: '取消归档',
  unarchiveNamed: '取消归档 {title}',
  delete: '删除会话',
  deleteNamed: '永久删除 {title}',
  deleteTitle: '删除会话',
  deleteDesc: '将永久销毁“{name}”的会话记录，且不可恢复。此操作会从归档中移除该会话。',
  deleteConfirm: '删除会话',
  deletePending: '正在删除…',
  cancel: '取消',
  close: '关闭',
  ungrouped: '未分组',
  'time.now': '刚刚',
  'time.minutes': '{n}分钟',
  'time.hours': '{n}小时',
  'time.days': '{n}天',
  'time.months': '{n}个月',
  'time.years': '{n}年',
} satisfies Record<string, string>

/** Archived-session page locale key union. */
export type ArchivedSessionsLocaleKey = keyof typeof zh

/** English dictionary checked against the Chinese key set. */
export const en = {
  nav: 'Archived sessions',
  search: 'Search archived sessions',
  loading: 'Reading sessions…',
  empty: 'No archived sessions.',
  unavailable: 'No archived session here can be restored.',
  emptySearch: 'No matching sessions.',
  unarchive: 'Unarchive',
  unarchiveNamed: 'Unarchive {title}',
  delete: 'Delete session',
  deleteNamed: 'Permanently delete {title}',
  deleteTitle: 'Delete session',
  deleteDesc: 'This permanently destroys the session log for “{name}”. It cannot be recovered, and the session is removed from the archive.',
  deleteConfirm: 'Delete session',
  deletePending: 'Deleting…',
  cancel: 'Cancel',
  close: 'Close',
  ungrouped: 'Ungrouped',
  'time.now': 'now',
  'time.minutes': '{n}min',
  'time.hours': '{n}h',
  'time.days': '{n}d',
  'time.months': '{n}mo',
  'time.years': '{n}y',
} satisfies Record<ArchivedSessionsLocaleKey, string>
