import React from 'react';
import NotificationBell from '../../notifications/NotificationBell';
import { staffApiRequest } from '../../../services/apiClient';
import { readStaffSession } from '../../../services/authStorage';
import { staffSocket } from '../../../services/staff/staffSocket';

const hasStaffSession = () => Boolean(readStaffSession()?.token);

export default function NotificationDropdown({
  userId,
  userRole = null,
  doctorId = null,
  lang = 'ar',
  onSelectNotification
}) {
  return (
    <NotificationBell
      variant="staff"
      userId={userId}
      userRole={userRole}
      doctorId={doctorId}
      lang={lang}
      socket={staffSocket}
      request={staffApiRequest}
      hasSession={hasStaffSession}
      onOpenIntent={onSelectNotification}
    />
  );
}
