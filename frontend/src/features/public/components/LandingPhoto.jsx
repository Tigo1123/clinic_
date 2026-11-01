// Native image loading keeps all page structure and reserved media frames mounted.
export default function LandingPhoto({ className, alt, fallbackLabel, ...imageProps }) {
  return <div className={`public-photo ${className}`}>
    <img {...imageProps} alt={alt}
      onError={event => { event.currentTarget.dataset.failed = 'true'; }}
      onLoad={event => { delete event.currentTarget.dataset.failed; }} />
    <span className="public-photo__fallback" aria-hidden="true">{fallbackLabel}</span>
  </div>;
}
