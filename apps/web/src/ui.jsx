import React, { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { X, Inbox, LoaderCircle } from 'lucide-react';
import { api } from './api';
export const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);
export function Button({ children, variant = 'primary', className = '', ...props }) { return <button className={`button ${variant} ${className}`} {...props}>{children}</button>; }
export function Field({ label, hint, children }) {
  const generatedId = useId(); const id = children.props.id || generatedId;
  return <div className="field"><label htmlFor={id}>{label}</label>{React.cloneElement(children, { id, ...(hint ? { 'aria-describedby': `${id}-hint` } : {}) })}{hint && <small id={`${id}-hint`}>{hint}</small>}</div>;
}
export function Badge({ value, children }) { const { t } = useApp(); return <span className={`badge ${value}`}>{children || t(value)}</span>; }
export function Empty({ text, children }) { const { t } = useApp(); return <div className="empty"><Inbox size={30}/><p>{t(text || 'empty')}</p>{children}</div>; }
export function Loading() { const { t } = useApp(); return <div className="loading"><LoaderCircle size={20} className="spin"/>{t('loading')}</div>; }
export function Modal({ title, children, onClose, wide = false }) {
  const ref = useRef(); const { t } = useApp();
  useEffect(() => { ref.current.showModal(); }, []);
  return <dialog ref={ref} className={`modal ${wide ? 'wide' : ''}`} aria-label={title} onCancel={onClose} onClick={e => { if (e.target === ref.current) onClose(); }}><div className="modal-head"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label={t('close')}><X size={20}/></button></div>{children}</dialog>;
}
export function PageTitle({ title, subtitle, action }) { return <div className="page-title"><div><h1>{title}</h1>{subtitle && <p>{subtitle}</p>}</div>{action}</div>; }
export function useResource(path) {
  const { revision, online } = useApp(); const [data, setData] = useState(null); const [error, setError] = useState(null);
  useEffect(() => {
    let alive = true; setData(null); setError(null);
    if (!path || !online) return;
    api(path).then(v => { if (alive) setData(v); }).catch(e => { if (alive) setError(e); });
    return () => { alive = false; };
  }, [path, revision, online]);
  return { data, setData, error };
}
export function ResourceState({ error, data, children }) {
  const { t, online, refresh } = useApp();
  if (!online) return <Empty text="offlineUnavailable"/>;
  if (error) return <div className="error-panel"><p>{t(error.code || 'requestFailed')}</p><Button variant="secondary" onClick={refresh}>{t('refresh')}</Button></div>;
  if (data === null) return <Loading/>;
  return children;
}
export function FormActions({ onCancel, label = 'save' }) { const { t, busy } = useApp(); return <div className="form-actions">{onCancel && <Button type="button" variant="secondary" onClick={onCancel}>{t('cancel')}</Button>}<Button disabled={busy} type="submit">{busy ? t('saving') : t(label)}</Button></div>; }
export function JalaliField({ name = 'date', label, defaultValue, required = true }) { const { t } = useApp(); return <Field label={label || t('date')}><input name={name} dir="ltr" placeholder="1405/07/04" defaultValue={defaultValue} required={required} inputMode="text" pattern="[0-9۰-۹٠-٩]{4}[/\-][0-9۰-۹٠-٩]{1,2}[/\-][0-9۰-۹٠-٩]{1,2}"/></Field>; }
