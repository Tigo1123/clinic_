import { useEffect, useRef } from 'react';
import { staffSocket } from '../services/staffSocket.js';

export function subscribeWorkflowRefresh(socket, topics, refresh, { windowTarget = window, documentTarget = document } = {}) {
  let scheduled = false; let running = false; let dirty = false; let disposed = false;
  const pendingTopics = new Set();
  const request = (topic = 'reconnected') => {
    if (disposed) return;
    dirty = true; pendingTopics.add(topic);
    if (scheduled || running) return;
    scheduled = true;
    queueMicrotask(async () => {
      scheduled = false; running = true;
      try {
        while (dirty && !disposed) {
          dirty = false; const changed = [...pendingTopics]; pendingTopics.clear();
          await refresh(changed);
        }
      } finally { running = false; }
    });
  };
  const event = data => { if (data?.topic === 'reconnected' || topics.includes(data?.topic)) request(data.topic); };
  const recover = () => request('reconnected');
  const queue = () => request('appointments');
  const visible = () => { if (documentTarget.visibilityState === 'visible') recover(); };
  socket.on('workflowUpdated', event); socket.on('connect', recover);
  if (topics.includes('appointments')) socket.on('queueUpdated', queue);
  windowTarget.addEventListener('focus', recover);
  documentTarget.addEventListener('visibilitychange', visible);
  return () => {
    disposed = true;
    socket.off('workflowUpdated', event); socket.off('connect', recover);
    socket.off('queueUpdated', queue);
    windowTarget.removeEventListener('focus', recover);
    documentTarget.removeEventListener('visibilitychange', visible);
  };
}

export function useWorkflowRefresh(topics, refresh) {
  const latest = useRef(refresh); latest.current = refresh;
  const key = topics.join(',');
  useEffect(() => subscribeWorkflowRefresh(staffSocket, key.split(','), changed => latest.current(changed)), [key]);
}
