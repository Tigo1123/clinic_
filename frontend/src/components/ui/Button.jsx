export default function Button({ variant = 'primary', loading = false, fullWidth = false, className = '', children, disabled, ...props }) {
  return <button className={`ui-button ui-button--${variant} ${fullWidth ? 'ui-button--full' : ''} ${className}`} disabled={disabled || loading} aria-busy={loading || undefined} {...props}>
    {loading && <span className="ui-spinner" aria-hidden="true" />}{children}
  </button>;
}
