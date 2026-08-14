import React, { useState, useEffect, useRef } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.VITE_STAFF_SOCKET_URL || (import.meta.env.DEV ? 'http://localhost:5000' : window.location.origin);
let socket;

export default function NotificationDropdown({ userId, lang = 'ar' }) {
  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  // Fetch initial notifications
  const fetchNotifications = async () => {
    try {
      const token = localStorage.getItem('cms_token');
      if (!token) return;

      const res = await fetch('/api/notifications', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  };

  useEffect(() => {
    if (!userId) return;

    fetchNotifications();

    // Connect to Socket.io server
    socket = io(SOCKET_URL, { auth: { token: localStorage.getItem('cms_token') } });

    // Listen for real-time notifications
    socket.on('notification', (newNotif) => {
      setNotifications((prev) => [newNotif, ...prev]);
      setUnreadCount((prev) => prev + 1);
    });

    return () => {
      if (socket) {
        socket.off('notification');
        socket.disconnect();
      }
    };
  }, [userId]);

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
      const token = localStorage.getItem('cms_token');
      const res = await fetch(`/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setNotifications((prev) =>
          prev.map((item) => (item.id === id ? { ...item, isRead: true } : item))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Failed to mark notification as read:', err);
    }
  };

  // Mark all notifications as read
  const markAllAsRead = async () => {
    try {
      const token = localStorage.getItem('cms_token');
      const res = await fetch('/api/notifications/read-all', {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (res.ok) {
        setNotifications((prev) => prev.map((item) => ({ ...item, isRead: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Failed to mark all notifications as read:', err);
    }
  };

  return (
    <div className="relative inline-block text-left" ref={dropdownRef} style={{ position: 'relative' }}>
      {/* Bell Button with Badge Counter */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 rounded-full hover:bg-gray-700/50 transition-colors focus:outline-none"
        style={{
          position: 'relative',
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          padding: '0.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--text-primary)'
        }}
        aria-label="Notifications"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span
            style={{
              position: 'absolute',
              top: '2px',
              right: '2px',
              backgroundColor: '#ef4444',
              color: '#ffffff',
              fontSize: '0.7rem',
              fontWeight: 'bold',
              borderRadius: '9999px',
              padding: '0.1rem 0.35rem',
              lineHeight: 1,
              minWidth: '16px',
              textAlign: 'center'
            }}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Notifications Dropdown Panel */}
      {isOpen && (
        <div
          style={{
            position: 'absolute',
            [lang === 'ar' ? 'left' : 'right']: 0,
            top: 'calc(100% + 0.5rem)',
            width: '320px',
            maxHeight: '400px',
            backgroundColor: 'var(--bg-card, #1e293b)',
            border: '1px solid var(--border-color, #334155)',
            borderRadius: '0.75rem',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.5)',
            zIndex: 1000,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden'
          }}
        >
          {/* Header */}
          <div
            style={{
              padding: '0.75rem 1rem',
              borderBottom: '1px solid var(--border-color, #334155)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(255, 255, 255, 0.03)'
            }}
          >
            <h4 style={{ margin: 0, fontSize: '0.95rem', fontWeight: 600 }}>
              {lang === 'ar' ? 'الإشعارات' : 'Notifications'}
            </h4>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={markAllAsRead}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--primary, #0d9488)',
                  fontSize: '0.75rem',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px'
                }}
              >
                <CheckCheck size={14} />
                {lang === 'ar' ? 'تحديد الكل كمقروء' : 'Mark all read'}
              </button>
            )}
          </div>

          {/* List */}
          <div style={{ overflowY: 'auto', flex: 1, padding: '0.5rem 0' }}>
            {notifications.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-secondary, #94a3b8)', fontSize: '0.85rem' }}>
                {lang === 'ar' ? 'لا توجد إشعارات حالياً' : 'No notifications yet'}
              </div>
            ) : (
              notifications.map((item) => (
                <div
                  key={item.id}
                  onClick={() => !item.isRead && markAsRead(item.id)}
                  style={{
                    padding: '0.75rem 1rem',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
                    backgroundColor: item.isRead ? 'transparent' : 'rgba(13, 148, 136, 0.08)',
                    cursor: item.isRead ? 'default' : 'pointer',
                    transition: 'background-color 0.2s',
                    position: 'relative'
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <span style={{ fontWeight: item.isRead ? 500 : 700, fontSize: '0.85rem', color: 'var(--text-primary)' }}>
                      {item.title}
                    </span>
                    <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary, #94a3b8)' }}>
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--text-secondary, #cbd5e1)', lineHeight: 1.4 }}>
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
