import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { staffApiRequest as apiRequest } from '../../../services/apiClient';
import { readStaffSession } from '../../../services/authStorage';
import { staffSocket as socket } from '../../../services/staff/staffSocket';
import './notificationDropdown.css';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function NotificationDropdown({ userId, lang = 'ar' }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  // Fetch initial notifications
  const fetchNotifications = useCallback(async () => {
    try {
      if (!readStaffSession()) return;
      const data = await apiRequest('/api/notifications');
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, []);

  useEffect(() => {
    if (!userId) return;

    fetchNotifications();

    // Listen for real-time notifications
    const handleNotification = (newNotif) => {
      setNotifications((prev) => [newNotif, ...prev]);
      setUnreadCount((prev) => prev + 1);
    };
    socket.on('notification', handleNotification);

    return () => {
      socket.off('notification', handleNotification);
    };
  }, [userId, fetchNotifications]);

  // Position panel dynamically to open within viewport in LTR, RTL, and narrow screens
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isRtl = (lang || '').startsWith('ar') ||
      (typeof document !== 'undefined' && (document.dir === 'rtl' || document.documentElement?.dir === 'rtl'));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(340, viewportWidth - 24);
    const panelHeight = Math.min(440, viewportHeight - 80);

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;

    const nextStyle = {};

    // Vertical positioning: prefer upward if near bottom of viewport (as in rail footer)
    if (spaceBelow < 340 && spaceAbove > spaceBelow) {
      const bottom = viewportHeight - rect.top + 8;
      nextStyle.bottom = `${Math.max(12, Math.min(bottom, viewportHeight - panelHeight - 12))}px`;
    } else {
      const top = rect.bottom + 8;
      nextStyle.top = `${Math.max(12, Math.min(top, viewportHeight - panelHeight - 12))}px`;
    }

    // Horizontal positioning: stay inside the viewport in both directions
    const maxOffset = Math.max(12, viewportWidth - panelWidth - 12);
    if (isRtl) {
      const right = viewportWidth - rect.right;
      nextStyle.right = `${Math.max(12, Math.min(right, maxOffset))}px`;
    } else {
      const left = rect.left;
      nextStyle.left = `${Math.max(12, Math.min(left, maxOffset))}px`;
    }

    setPanelStyle(nextStyle);
  }, [lang]);

  useIsomorphicLayoutEffect(() => {
    if (!isOpen) return undefined;
    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);
    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  // Close dropdown on click outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Mark single notification as read
  const markAsRead = async (id) => {
    try {
      await apiRequest(`/api/notifications/${id}/read`, { method: 'PATCH' });
      setNotifications((prev) =>
        prev.map((item) => (item.id === id ? { ...item, isRead: true } : item))
      );
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      await apiRequest('/api/notifications/read-all', { method: 'PATCH' });
      setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  return (
    <div className="notification-dropdown" ref={dropdownRef}>
      {/* Bell Button with Badge Counter */}
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        className="staff-shell__footer-btn notification-dropdown__trigger"
        aria-label="Notifications"
        aria-expanded={isOpen}
      >
        <Bell size={16} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-dropdown__badge ui-mono" aria-label={`${unreadCount} unread`}>
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Dropdown Panel */}
      {isOpen && (
        <div className="notification-dropdown__panel" style={panelStyle} role="region" aria-label={lang === 'ar' ? 'الإشعارات' : 'Notifications'}>
          {/* Header */}
          <div className="notification-dropdown__header">
            <h4 className="notification-dropdown__title">
              {lang === 'ar' ? 'الإشعارات' : 'Notifications'}
            </h4>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="notification-dropdown__mark-all"
              >
                <CheckCheck size={14} aria-hidden="true" />
                {lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div className="notification-dropdown__list">
            {notifications.length === 0 ? (
              <div className="notification-dropdown__empty">
                {lang === 'ar' ? 'لا توجد إشعارات حالياً' : 'No notifications yet'}
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => !item.isRead && markAsRead(item.id)}
                  className={`notification-dropdown__item${item.isRead ? '' : ' notification-dropdown__item--unread'}`}
                  role={item.isRead ? undefined : 'button'}
                  tabIndex={item.isRead ? undefined : 0}
                  onKeyDown={(e) => {
                    if (!item.isRead && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault();
                      markAsRead(item.id);
                    }
                  }}
                >
                  <div className="notification-dropdown__item-header">
                    <span className="notification-dropdown__item-title">
                      {!item.isRead && <span className="notification-dropdown__unread-dot" aria-hidden="true" />}
                      {item.title}
                    </span>
                    <span className="notification-dropdown__item-time ui-mono">
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p className="notification-dropdown__item-message">
                    {item.message}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
