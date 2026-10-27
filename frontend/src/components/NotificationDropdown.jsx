import { useEffect, useId, useRef, useState } from 'react';
import { Bell, CheckCheck, X } from 'lucide-react';
import { staffApiRequest } from '../services/apiClient';
import { staffSocket } from '../services/staffSocket';
import { createNotificationFeed, emptyNotificationFeed } from '../services/notificationFeed.js';
import './notificationDropdown.css';

export default function NotificationDropdown({ userId, lang = 'ar' }) {
  const [feed, setFeed] = useState(emptyNotificationFeed);
  const [open, setOpen] = useState(false);
  const root = useRef(null); const bell = useRef(null); const store = useRef(null);
  const panelId = useId(); const ar = lang === 'ar';
  const label = ar ? 'الإشعارات' : 'Notifications';

  useEffect(() => {
    setFeed(emptyNotificationFeed);
    if (!userId) return;
    const current = createNotificationFeed(staffApiRequest, setFeed); store.current = current;
    const refresh = () => { current.refresh(); };
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    staffSocket.on('notification', refresh); staffSocket.on('notifications:changed', refresh); staffSocket.on('connect', refresh);
    window.addEventListener('focus', refresh); document.addEventListener('visibilitychange', visible);
    refresh();
    return () => {
      current.dispose(); store.current = null;
      staffSocket.off('notification', refresh); staffSocket.off('notifications:changed', refresh); staffSocket.off('connect', refresh);
      window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', visible);
    };
  }, [userId]);

  useEffect(() => {
    if (!open) return;
    const outside = event => { if (!root.current?.contains(event.target)) setOpen(false); };
    const escape = event => { if (event.key === 'Escape') { setOpen(false); bell.current?.focus(); } };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);

  return <div className="notification-root" ref={root} dir={ar ? 'rtl' : 'ltr'}>
    <button type="button" ref={bell} className="notification-bell" aria-label={`${label} (${feed.unreadCount})`} aria-expanded={open} aria-controls={panelId}
      onClick={() => { if (!open) store.current?.refresh(); setOpen(value => !value); }}>
      <Bell size={22} aria-hidden="true" />
      {feed.unreadCount > 0 && <span className="notification-badge" aria-hidden="true">{feed.unreadCount > 99 ? '99+' : feed.unreadCount}</span>}
    </button>
    <span className="notification-sr" role="status" aria-live="polite">{ar ? `إشعارات غير مقروءة: ${feed.unreadCount}` : `${feed.unreadCount} unread notifications`}</span>
    {open && <section id={panelId} className="notification-panel" aria-label={label}>
      <header><strong>{label}</strong><button type="button" className="notification-close" aria-label={ar ? 'إغلاق الإشعارات' : 'Close notifications'} onClick={() => { setOpen(false); bell.current?.focus(); }}><X size={18} /></button></header>
      {feed.unreadCount > 0 && <button type="button" className="notification-read-all" disabled={feed.pending} onClick={() => store.current?.markRead()}><CheckCheck size={16} />{ar ? 'تحديد الكل كمقروء' : 'Mark all read'}</button>}
      {feed.error && <div role="alert" className="notification-feedback">{ar ? 'تعذر تحديث الإشعارات.' : 'Unable to update notifications.'} <button type="button" onClick={() => store.current?.refresh()}>{ar ? 'إعادة المحاولة' : 'Retry'}</button></div>}
      {feed.loading && <p className="notification-feedback" role="status">{ar ? 'جارٍ التحميل…' : 'Loading…'}</p>}
      {!feed.loading && !feed.error && !feed.notifications.length && <p className="notification-feedback">{ar ? 'لا توجد إشعارات حالياً' : 'No notifications yet'}</p>}
      <ul className="notification-list">{feed.notifications.map(item => <li key={item.id} className={item.isRead ? 'is-read' : 'is-unread'}>
        <strong>{ar ? (item.titleAr || 'تحديث تشغيلي') : (item.titleEn || item.title || 'Operational update')}</strong>
        <p>{ar ? (item.messageAr || 'افتح مساحة العمل المعنية لمراجعة هذا التحديث.') : (item.messageEn || item.message || 'Open the relevant workspace to review this update.')}</p>
        <footer><time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString(ar ? 'ar' : 'en', { dateStyle: 'short', timeStyle: 'short' })}</time>
          {!item.isRead && <button type="button" disabled={feed.pending} onClick={() => store.current?.markRead(item.id)}>{ar ? 'تحديد كمقروء' : 'Mark read'}</button>}
        </footer>
      </li>)}</ul>
      {feed.nextCursor && <button type="button" className="notification-more" disabled={feed.loading || feed.pending} onClick={() => store.current?.loadMore()}>{ar ? 'عرض المزيد' : 'Load more'}</button>}
    </section>}
  </div>;
}
