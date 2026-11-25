import { useCallback, useEffect, useRef, useState } from 'react';
import {
  applyIncomingSocketNotification,
  applyMarkNotificationRead,
  reconcileNotificationsSnapshot
} from './notificationModel.js';

/**
 * Shared real-time notification state hook for both Staff and Patient portals.
 * - Loads initial list + unread count from /api/notifications
 * - Refreshes on socket reconnect to recover missed updates
 * - Deduplicates incoming real-time socket 'notification' events by id
 * - Clears state cleanly when userId changes or session ends
 */
export function useNotifications({
  userId,
  socket,
  request,
  hasSession,
  enabled = true
}) {
  const [state, setState] = useState({ userId: null, notifications: [], unreadCount: 0 });
  const [loadError, setLoadError] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchSeqRef = useRef(0);
  const inFlightRef = useRef(false);
  const inFlightSocketBufferRef = useRef([]);
  const activeUserRef = useRef(userId);
  activeUserRef.current = userId;

  const fetchNotifications = useCallback(async () => {
    if (!enabled || !userId) return;
    if (typeof hasSession === 'function' && !hasSession()) return;

    const seq = ++fetchSeqRef.current;
    const fetchUserId = userId;
    inFlightRef.current = true;
    setLoading(true);

    try {
      const data = await request('/api/notifications');
      if (seq !== fetchSeqRef.current || activeUserRef.current !== fetchUserId) return;
      const buffered = inFlightSocketBufferRef.current;
      inFlightSocketBufferRef.current = [];
      inFlightRef.current = false;
      setState((previous) => ({
        userId: fetchUserId,
        ...reconcileNotificationsSnapshot(data, buffered, previous.userId === fetchUserId ? previous : {}),
      }));
      setLoadError(false);
    } catch {
      if (seq !== fetchSeqRef.current || activeUserRef.current !== fetchUserId) return;
      inFlightRef.current = false;
      inFlightSocketBufferRef.current = [];
      setLoadError(true);
    } finally {
      if (seq === fetchSeqRef.current && activeUserRef.current === fetchUserId) {
        setLoading(false);
      }
    }
  }, [enabled, hasSession, request, userId]);

  useEffect(() => {
    fetchSeqRef.current += 1;
    inFlightRef.current = false;
    inFlightSocketBufferRef.current = [];
    setState({ userId, notifications: [], unreadCount: 0 });
    setLoadError(false);
    setLoading(false);
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId) return undefined;

    fetchNotifications();

    if (!socket) return undefined;

    const handleNotification = (newNotif) => {
      if (activeUserRef.current !== userId || newNotif?.userId !== userId) return;
      if (inFlightRef.current) inFlightSocketBufferRef.current.push(newNotif);
      setState((previous) => ({
        userId,
        ...applyIncomingSocketNotification(previous.userId === userId ? previous : {}, newNotif),
      }));
    };

    const handleReconnect = () => {
      fetchNotifications();
    };

    socket.on('notification', handleNotification);
    socket.on('connect', handleReconnect);

    return () => {
      socket.off('notification', handleNotification);
      socket.off('connect', handleReconnect);
    };
  }, [enabled, fetchNotifications, socket, userId]);

  const markAsRead = useCallback(async (id) => {
    if (!id || !enabled || !userId) return false;
    try {
      await request(`/api/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
      if (activeUserRef.current !== userId) return false;
      setState((previous) => ({ userId, ...applyMarkNotificationRead(previous, id) }));
      setLoadError(false);
      return true;
    } catch {
      if (activeUserRef.current === userId) setLoadError(true);
      return false;
    }
  }, [enabled, request, userId]);

  const markAllAsRead = useCallback(async () => {
    if (!enabled || !userId) return false;
    try {
      await request('/api/notifications/read-all', { method: 'PATCH' });
      if (activeUserRef.current !== userId) return false;
      await fetchNotifications();
      return true;
    } catch {
      if (activeUserRef.current === userId) setLoadError(true);
      return false;
    }
  }, [enabled, fetchNotifications, request, userId]);

  return {
    notifications: enabled && state.userId === userId ? state.notifications : [],
    unreadCount: enabled && state.userId === userId ? state.unreadCount : 0,
    loading,
    loadError,
    fetchNotifications,
    markAsRead,
    markAllAsRead
  };
}
