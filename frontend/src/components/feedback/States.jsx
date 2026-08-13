import { AlertCircle, CalendarPlus } from 'lucide-react';

export function Skeleton({ rows = 3 }) { return <div className="skeleton-stack" aria-label="Loading">{Array.from({ length: rows }, (_, index) => <div className="skeleton-line" key={index} />)}</div>; }
export function EmptyState({ title, message, action }) { return <div className="empty-state"><CalendarPlus aria-hidden="true" /><h2>{title}</h2>{message && <p>{message}</p>}{action}</div>; }
export function ErrorState({ message, onRetry }) { return <div className="error-state" role="alert"><AlertCircle aria-hidden="true" /><h2>Something went wrong</h2><p>{message}</p>{onRetry && <button className="ui-button ui-button--outline" onClick={onRetry}>Try again</button>}</div>; }
