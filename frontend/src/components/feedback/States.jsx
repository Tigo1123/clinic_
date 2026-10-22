import { AlertCircle, CalendarPlus } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function Skeleton({ rows = 3 }) { const { t } = useTranslation(); return <div className="skeleton-stack" role="status" aria-label={t('loading')} aria-busy="true">{Array.from({ length: rows }, (_, index) => <div className="skeleton-line" aria-hidden="true" key={index} />)}</div>; }
export function EmptyState({ title, message, action }) { return <div className="empty-state"><CalendarPlus aria-hidden="true" /><h2>{title}</h2>{message && <p>{message}</p>}{action}</div>; }
export function ErrorState({ message, onRetry }) { const { t } = useTranslation(); return <div className="error-state" role="alert"><AlertCircle aria-hidden="true" /><h2>{t('patientLoadError')}</h2><p>{message}</p>{onRetry && <button className="ui-button ui-button--outline" onClick={onRetry}>{t('patientRetry')}</button>}</div>; }
