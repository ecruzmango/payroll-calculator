import { useCallback, useEffect, useRef, useState } from 'react';
import SubmissionRow from './SubmissionRow.jsx';
import {
  formUrl,
  syncList,
  fetchSubmissions,
  markApplied,
  fetchReminder,
  markReminderSent,
  testReminderPush
} from '../lib/api.js';


const timeAgo = ts => {
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `hace ${hours} h`;
  return new Date(ts).toLocaleDateString('es-ES');
};

/**
 * The shared form: activation, the link to send, and the inbox of submitted
 * hours. Nothing here writes to the table on its own — the owner applies each
 * submission, because these numbers become someone's paycheck.
 */
export default function FormPanel({ slot, weekOf, workers, onServerChange, onApply }) {
  const server = slot.server;

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [reminder, setReminder] = useState(null);
  const [copied, setCopied] = useState(false);
  const [messageCopied, setMessageCopied] = useState(false);
  // Open by default so the form and its link are discoverable; the owner can
  // collapse it once they know where it lives.
  const [open, setOpen] = useState(true);
  const linkRef = useRef(null);
  // Re-opens once if something needs doing while collapsed, then leaves the
  // choice alone — reopening a panel the owner just closed would be obnoxious.
  const autoOpened = useRef(false);

  const link = server ? formUrl(server.token) : null;

  const refresh = useCallback(async () => {
    if (!server) return;
    setError(null);
    try {
      const [submissions, reminderState] = await Promise.all([
        fetchSubmissions({ listId: slot.id, managerSecret: server.managerSecret, weekOf }),
        fetchReminder({ listId: slot.id, managerSecret: server.managerSecret })
      ]);
      setInbox(submissions);
      setReminder(reminderState);
    } catch (err) {
      setError(err.message);
    }
  }, [server, slot.id, weekOf]);

  const handleTestPush = async () => {
    setError(null);
    setNotice('Enviando notificación de prueba…');
    try {
      const r = await testReminderPush({ listId: slot.id, managerSecret: server.managerSecret });
      setNotice(
        `Notificación de prueba enviada (${r.missing} de ${r.total} sin enviar). ` +
          'Revisa tu teléfono. El recordatorio real del viernes no cambia.'
      );
    } catch (err) {
      setNotice(null);
      setError(err.message);
    }
  };

  const handleReminderSent = async () => {
    try {
      await markReminderSent({ listId: slot.id, managerSecret: server.managerSecret });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    setInbox(null);
    setReminder(null);
    refresh();
  }, [refresh]);

  // Push the active week to the server whenever it changes, so the worker form,
  // the reminder message and this inbox always name the same week. Without it
  // the server keeps offering the old week after "Empezar nueva semana".
  // `workers` is read from the closure rather than declared as a dependency:
  // its identity changes on every keystroke, which would sync constantly.
  const syncedWeek = useRef(null);
  useEffect(() => {
    if (!server || !weekOf || syncedWeek.current === weekOf) return;
    syncedWeek.current = weekOf;

    syncList({
      listId: slot.id,
      name: slot.name,
      weekOf,
      workers: workers.filter(w => w.name.trim()),
      managerSecret: server.managerSecret
    })
      .then(refresh)
      .catch(err => setError(err.message));
  }, [server, weekOf, slot.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const namedWorkers = workers.filter(w => w.name.trim());

  const handleActivate = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await syncList({
        listId: slot.id,
        name: slot.name,
        weekOf,
        workers: namedWorkers,
        managerSecret: server?.managerSecret
      });
      setNotice(
        result.created
          ? 'Formulario activado. Ya puedes enviar el enlace.'
          : `Lista actualizada (${result.workerCount} trabajadores).`
      );

      // The secret is returned only when the list is first created — including
      // when the server has lost the list and recreates it. Storing it changes
      // the `server` prop, which re-runs the effect and refetches with the new
      // credentials; refreshing here would still be using the stale secret.
      if (result.managerSecret) {
        onServerChange({ token: result.token, managerSecret: result.managerSecret });
      } else {
        await refresh();
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  /**
   * Copy text to the clipboard, falling back for insecure contexts.
   * navigator.clipboard is [SecureContext], so it is missing on a plain http://
   * LAN address — exactly the setup used to test on a phone.
   */
  const copyText = async text => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    // execCommand only copies a live selection, so stage the text in a
    // throwaway textarea rather than disturbing what is on screen.
    const staging = document.createElement('textarea');
    staging.value = text;
    staging.setAttribute('readonly', '');
    staging.style.position = 'fixed';
    staging.style.opacity = '0';
    document.body.appendChild(staging);
    try {
      staging.select();
      staging.setSelectionRange(0, staging.value.length);
      if (!document.execCommand('copy')) throw new Error('execCommand refused');
    } finally {
      staging.remove();
    }
  };

  const handleCopy = async () => {
    setError(null);
    try {
      await copyText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Leave the link selected so Cmd+C works as the last resort.
      linkRef.current?.focus();
      linkRef.current?.select();
      setError('No se pudo copiar. El enlace ya está seleccionado: pulsa Cmd+C.');
    }
  };

  /** Copy the full weekly message, ready to paste into a broadcast list. */
  const handleCopyMessage = async () => {
    setError(null);
    try {
      await copyText(reminder.message);
      setMessageCopied(true);
      setTimeout(() => setMessageCopied(false), 2500);
    } catch {
      setError('No se pudo copiar el mensaje.');
    }
  };

  const handleApply = async (submission, hours = submission.hours) => {
    onApply(submission.workerId, hours);
    try {
      await markApplied({ listId: slot.id, managerSecret: server.managerSecret, ids: [submission.id] });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleApplyAll = async () => {
    const pending = (inbox?.submissions ?? []).filter(s => !s.appliedAt);
    if (!pending.length) return;
    if (!window.confirm(`Se aplicarán ${pending.length} envíos a la tabla. ¿Continuar?`)) return;

    pending.forEach(s => onApply(s.workerId, s.hours));
    try {
      await markApplied({
        listId: slot.id,
        managerSecret: server.managerSecret,
        ids: pending.map(s => s.id)
      });
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  };

  const nameOf = id => workers.find(w => w.id === id)?.name?.trim() || 'Trabajador desconocido';

  const pending = (inbox?.submissions ?? []).filter(s => !s.appliedAt).length;
  const needsAttention = pending > 0 || Boolean(reminder?.due);

  useEffect(() => {
    if (needsAttention && !autoOpened.current) {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [needsAttention]);

  if (!server) {
    return (
      <div className="form-panel">
        <div className="form-panel-head">
          <div>
            <strong>Formulario para trabajadores</strong>
            <p className="form-panel-sub">
              Crea un enlace que los trabajadores abren en su teléfono para enviar sus horas.
            </p>
          </div>
          <button onClick={handleActivate} disabled={busy || !namedWorkers.length}>
            {busy ? 'Activando…' : 'Activar formulario'}
          </button>
        </div>
        {!namedWorkers.length && (
          <p className="form-panel-sub">Agrega trabajadores con nombre antes de activar.</p>
        )}
        {error && <p className="form-panel-error">{error}</p>}
      </div>
    );
  }

  return (
    <div className={`form-panel${open ? '' : ' is-closed'}`}>
      {/* Collapsed by default: the summary line carries whatever needs doing,
          so the table stays the focus until there is something to act on. */}
      <button className="panel-toggle" onClick={() => setOpen(o => !o)} aria-expanded={open}>
        <span className={`chevron${open ? ' is-open' : ''}`} aria-hidden="true">
          ›
        </span>
        <strong>Formulario para trabajadores</strong>
        <span className="panel-chips">
          {reminder?.due && <span className="chip chip-accent">Falta enviar el enlace</span>}
          {pending > 0 && <span className="chip chip-warn">{pending} sin aplicar</span>}
          {!needsAttention && inbox && <span className="chip chip-quiet">Al día</span>}
        </span>
      </button>

      {!open && reminder?.due && (
        <div className="reminder reminder-compact">
          <span className="reminder-text">
            <strong>📣 Toca enviar el enlace de esta semana</strong>
          </span>
          <div className="reminder-actions">
            <button className="reminder-send" onClick={handleCopyMessage}>
              {messageCopied ? '¡Copiado!' : 'Copiar mensaje'}
            </button>
            <button className="btn-secondary btn-small" onClick={handleReminderSent}>
              Ya lo envié
            </button>
          </div>
        </div>
      )}

      <div className="panel-body" hidden={!open}>
      <div className="form-panel-actions">
        <button className="btn-secondary btn-small" onClick={handleActivate} disabled={busy}>
          {busy ? 'Sincronizando…' : 'Sincronizar trabajadores'}
        </button>
        <button className="btn-secondary btn-small" onClick={refresh}>
          Buscar envíos
        </button>
        {reminder?.pushConfigured && (
          <button
            className="btn-secondary btn-small"
            onClick={handleTestPush}
            title="Envía ahora la notificación semanal, sin esperar al viernes"
          >
            Probar aviso
          </button>
        )}
      </div>

      <div className="link-row">
        <input ref={linkRef} type="text" readOnly value={link} onFocus={e => e.target.select()} />
        <button className="btn-small" onClick={handleCopy}>
          {copied ? '¡Copiado!' : 'Copiar'}
        </button>
      </div>

      {error && <p className="form-panel-error">{error}</p>}
      {notice && <p className="form-panel-note">{notice}</p>}

      {reminder?.due && (
        <div className="reminder">
          <div className="reminder-text">
            <strong>📣 Toca enviar el enlace de esta semana</strong>
            <span>
              Semana del {reminder.weekLabel}. Envíalo a la lista de difusión de WhatsApp.
            </span>
          </div>
          {/* No WhatsApp button: wa.me opens the contact picker, which does not
              list broadcast lists. Copy, then paste into the saved list. */}
          <div className="reminder-actions">
            <button className="reminder-send" onClick={handleCopyMessage}>
              {messageCopied ? '¡Mensaje copiado!' : 'Copiar mensaje'}
            </button>
            <button className="btn-secondary btn-small" onClick={handleReminderSent}>
              Ya lo envié
            </button>
          </div>
        </div>
      )}

      {reminder?.alreadySent && (
        <p className="form-panel-note">✓ Ya enviaste el enlace de esta semana.</p>
      )}

      {inbox && (
        <div className="inbox">
          <div className="inbox-head">
            <strong>Envíos de la semana del {inbox.weekLabel}</strong>
            {pending > 0 && (
              <button className="btn-small" onClick={handleApplyAll}>
                Aplicar todo ({pending})
              </button>
            )}
          </div>

          {!inbox.submissions.length && (
            <p className="form-panel-sub">Todavía nadie ha enviado sus horas.</p>
          )}

          {inbox.submissions.map(s => (
            <SubmissionRow
              key={s.id}
              submission={s}
              workerName={nameOf(s.workerId)}
              onApply={handleApply}
            />
          ))}

          {inbox.missing.length > 0 && (
            <p className="missing-line">
              <strong>Faltan por enviar:</strong> {inbox.missing.map(w => w.name).join(', ')}
            </p>
          )}
        </div>
      )}
      </div>
    </div>
  );
}
