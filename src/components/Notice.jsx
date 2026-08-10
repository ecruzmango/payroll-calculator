export default function Notice({ tone = 'info', title, messages = [], onDismiss }) {
  if (!messages.length) return null;

  const shown = messages.slice(0, 8);
  const extra = messages.length - shown.length;

  return (
    <div className={`notice notice-${tone}`} role="status">
      <div className="notice-head">
        <strong>{title}</strong>
        {onDismiss && (
          <button type="button" className="notice-close" onClick={onDismiss} aria-label="Cerrar">
            ×
          </button>
        )}
      </div>
      <ul>
        {shown.map((m, i) => (
          <li key={i}>{m}</li>
        ))}
        {extra > 0 && <li>…y {extra} más</li>}
      </ul>
    </div>
  );
}
