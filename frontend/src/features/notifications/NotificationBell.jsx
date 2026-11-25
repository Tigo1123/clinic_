import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { Bell, CheckCheck, ChevronLeft, ChevronRight } from 'lucide-react';
import {
  formatNotificationPresentation,
  isArabicLanguage,
  notificationFeedbackCopy
} from './notificationModel.js';
import { useNotifications } from './useNotifications.js';
import './notificationBell.css';

const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

export default function NotificationBell({
  userId,
  userRole = null,
  doctorId = null,
  lang = 'ar',
  socket,
  request,
  hasSession,
  onOpenIntent,
  variant = 'staff'
}) {
  const isAr = isArabicLanguage(lang);
  const {
    notifications,
    unreadCount,
    loadError,
    fetchNotifications,
    markAsRead,
    markAllAsRead
  } = useNotifications({ userId, socket, request, hasSession });

  const [isOpen, setIsOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});
  const [feedbackMsg, setFeedbackMsg] = useState('');
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    setIsOpen(false);
    setFeedbackMsg('');
  }, [userId]);

  const updatePosition = useCallback(() => {
    if (!triggerRef.current || typeof window === 'undefined') return;
    const rect = triggerRef.current.getBoundingClientRect();
    const isRtl = isAr ||
      (typeof document !== 'undefined' && (document.dir === 'rtl' || document.documentElement?.dir === 'rtl'));
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const panelWidth = Math.min(360, viewportWidth - 24);
    const panelHeight = Math.min(460, viewportHeight - 80);

    const spaceBelow = viewportHeight - rect.bottom;
    const spaceAbove = rect.top;
    const nextStyle = {};

    if (spaceBelow < 340 && spaceAbove > spaceBelow) {
      const bottom = viewportHeight - rect.top + 8;
      nextStyle.bottom = `${Math.max(12, Math.min(bottom, viewportHeight - panelHeight - 12))}px`;
    } else {
      const top = rect.bottom + 8;
      nextStyle.top = `${Math.max(12, Math.min(top, viewportHeight - panelHeight - 12))}px`;
    }

    const maxOffset = Math.max(12, viewportWidth - panelWidth - 12);
    if (isRtl) {
      const right = viewportWidth - rect.right;
      nextStyle.right = `${Math.max(12, Math.min(right, maxOffset))}px`;
    } else {
      const left = rect.left;
      nextStyle.left = `${Math.max(12, Math.min(left, maxOffset))}px`;
    }

    setPanelStyle(nextStyle);
  }, [isAr]);

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

  useEffect(() => {
    if (!isOpen) return undefined;
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setIsOpen(false);
        triggerRef.current?.focus?.();
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleToggleOpen = () => {
    setFeedbackMsg('');
    setIsOpen((prev) => {
      const next = !prev;
      if (next && loadError) fetchNotifications();
      return next;
    });
  };

  const handleItemActivate = async (item, presentation) => {
    setFeedbackMsg('');
    const { intent } = presentation;

    if (!item.isRead) {
      markAsRead(item.id);
    }

    if (intent.kind === 'navigate' || intent.kind === 'drilldown') {
      if (typeof onOpenIntent === 'function') {
        setIsOpen(false);
        onOpenIntent(intent, item);
        return;
      }
    }

    if (intent.kind === 'restricted' || intent.kind === 'missing_target') {
      setFeedbackMsg(notificationFeedbackCopy(intent.reason, lang));
    }
  };

  const bellLabel = isAr ? 'الإشعارات' : 'Notifications';
  const unreadLabel = isAr ? `${unreadCount} غير مقروء` : `${unreadCount} unread`;
  const triggerClass = variant === 'patient'
    ? 'patient-icon-button patient-header__btn notification-dropdown__trigger notification-dropdown__trigger--patient'
    : 'staff-shell__footer-btn notification-dropdown__trigger';
  const ArrowIcon = isAr ? ChevronLeft : ChevronRight;

  return (
    <div className="notification-dropdown" ref={dropdownRef}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleToggleOpen}
        className={triggerClass}
        aria-label={unreadCount > 0 ? `${bellLabel} (${unreadLabel})` : bellLabel}
        title={bellLabel}
        aria-haspopup="true"
        aria-expanded={isOpen}
      >
        <Bell size={variant === 'patient' ? 18 : 16} strokeWidth={1.8} aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="notification-dropdown__badge ui-mono" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          className="notification-dropdown__panel"
          style={panelStyle}
          dir={isAr ? 'rtl' : 'ltr'}
          role="region"
          aria-label={bellLabel}
        >
          <div className="notification-dropdown__header">
            <h4 className="notification-dropdown__title">{bellLabel}</h4>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                className="notification-dropdown__mark-all"
              >
                <CheckCheck size={14} aria-hidden="true" />
                {isAr ? 'تحديد الكل كمقروء' : 'Mark all read'}
              </button>
            )}
          </div>

          {loadError && (
            <div role="alert" className="patient-alert error notification-dropdown__alert">
              <span>{isAr ? 'تعذر تحميل الإشعارات.' : 'Could not load notifications.'}</span>{' '}
              <button
                type="button"
                onClick={fetchNotifications}
                className="notification-dropdown__retry"
              >
                {isAr ? 'إعادة المحاولة' : 'Retry'}
              </button>
            </div>
          )}

          {feedbackMsg && (
            <div role="status" className="patient-alert info notification-dropdown__alert">
              {feedbackMsg}
            </div>
          )}

          <div className="notification-dropdown__list">
            {notifications.length === 0 ? (
              <div className="notification-dropdown__empty">
                {isAr ? 'لا توجد إشعارات حالياً' : 'No notifications yet'}
              </div>
            ) : (
              notifications.map((item) => {
                const presentation = formatNotificationPresentation(item, lang, userRole, doctorId);
                const { intent } = presentation;
                const canOpen = (intent.kind === 'navigate' || intent.kind === 'drilldown') && typeof onOpenIntent === 'function';
                const isInteractive = !item.isRead || canOpen || intent.kind === 'restricted' || intent.kind === 'missing_target';

                return (
                  <div
                    key={item.id}
                    onClick={() => isInteractive && handleItemActivate(item, presentation)}
                    className={`notification-dropdown__item${item.isRead ? '' : ' notification-dropdown__item--unread'}${isInteractive ? ' notification-dropdown__item--interactive' : ''}`}
                    role={isInteractive ? 'button' : undefined}
                    tabIndex={isInteractive ? 0 : undefined}
                    onKeyDown={(event) => {
                      if (isInteractive && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        handleItemActivate(item, presentation);
                      }
                    }}
                  >
                    <div className="notification-dropdown__item-header">
                      <span className="notification-dropdown__item-title">
                        {!item.isRead && <span className="notification-dropdown__unread-dot" aria-hidden="true" />}
                        {presentation.title}
                      </span>
                      <span className="notification-dropdown__item-time ui-mono" dir="ltr">
                        {formatNotificationTime(item.createdAt, isAr)}
                      </span>
                    </div>
                    {presentation.message && (
                      <p className="notification-dropdown__item-message">
                        {presentation.message}
                      </p>
                    )}
                    {presentation.actionLabel && canOpen && (
                      <span className="notification-dropdown__item-action">
                        <span>{presentation.actionLabel}</span>
                        <ArrowIcon size={13} aria-hidden="true" />
                      </span>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function formatNotificationTime(value, isAr) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString(isAr ? 'ar' : 'en', { hour: '2-digit', minute: '2-digit' });
}
