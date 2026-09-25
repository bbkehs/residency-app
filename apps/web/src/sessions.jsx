import React, { useEffect, useState } from 'react';
import { Plus, CalendarDays, MapPin, ArrowLeft, Download, Users, Check, X, Search, ArrowUpRight, RefreshCw } from 'lucide-react';
import { jalaliToday, jalaliToISO, jalaliDateTime } from '@residency/domain';
import { api } from './api';
import { cache, enqueue, loadQueue, queueKey } from './offline';
import { useApp, Button, Field, Badge, Empty, Loading, Modal, PageTitle, FormActions, JalaliField } from './ui';

export function SessionForm({ onClose, original }) {
  const { t, user, directory, run, flash, refresh, go } = useApp(); const initialCohorts = original?.cohortIds || [user.cohortId];
  const [cohorts, setCohorts] = useState(initialCohorts); const [professors, setProfessors] = useState(original?.professorIds || []);
  const start = original ? jalaliDateTime(original.startAt) : { date: jalaliToday(), time: '08:00' }; const end = original ? jalaliDateTime(original.endAt) : { date: jalaliToday(), time: '09:00' };
  const toggle = (list, value, setter) => setter(list.includes(value) ? list.filter(x => x !== value) : [...list, value]);
  const submit = e => { e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget)); run(async () => {
    const body = { title: form.title, description: form.description, room: form.room, startAt: jalaliToISO(form.startDate, form.startTime), endAt: jalaliToISO(form.endDate, form.endTime), professorIds: professors, cohortIds: cohorts };
    const result = await api(original ? `/sessions/${original._id}/revisions` : '/sessions', { method: 'POST', body });
    flash(t(result.warnings.length ? 'overlapWarning' : 'proposed')); refresh(); onClose(); go(`sessions/${result.session._id}`);
  }); };
  return <Modal title={t(original ? 'reviseSession' : 'newSession')} onClose={onClose} wide><p className="muted">{t('scheduleNote')}</p><form onSubmit={submit}>
    <Field label={t('title')}><input name="title" required minLength={2} maxLength={160} defaultValue={original?.title} autoFocus/></Field>
    <div className="form-grid"><JalaliField name="startDate" label={t('startDate')} defaultValue={start.date}/><Field label={t('startTime')}><input type="time" name="startTime" required defaultValue={start.time}/></Field><JalaliField name="endDate" label={t('endDate')} defaultValue={end.date}/><Field label={t('endTime')}><input type="time" name="endTime" required defaultValue={end.time}/></Field></div>
    <Field label={t('room')}><input name="room" maxLength={120} defaultValue={original?.room}/></Field>
    <fieldset><legend>{t('professors')}</legend>{directory.professors.length ? <div className="check-grid">{directory.professors.map(p => <label className="check-option" key={p._id}><input type="checkbox" checked={professors.includes(p._id)} onChange={() => toggle(professors, p._id, setProfessors)}/>{p.name}</label>)}</div> : <p className="notice">{t('noProfessors')}</p>}</fieldset>
    <fieldset><legend>{t('participants')}</legend><div className="check-grid">{directory.cohorts.map(c => <label className="check-option" key={c._id}><input type="checkbox" checked={cohorts.includes(c._id)} disabled={Boolean(original) || c._id === user.cohortId} onChange={() => toggle(cohorts, c._id, setCohorts)}/>{t('year')} {c.year}</label>)}</div></fieldset>
    <Field label={t('description')}><textarea name="description" maxLength={2000} rows={3} defaultValue={original?.description}/></Field><FormActions onCancel={onClose} label="submit"/>
  </form></Modal>;
}

export function SessionsPage() {
  const { t, user, sessions, online, go, date, time } = useApp(); const [creating, setCreating] = useState(false); const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const filtered = sessions.filter(s => s.title.toLowerCase().includes(search.toLowerCase()) && (filter === 'all' || s.participations.some(p => p.status === filter)));
  return <><PageTitle title={t('sessions')} subtitle={t('sessionsSub')} action={(user.kind === 'admin' || user.isRep) && <Button onClick={() => setCreating(true)} disabled={!online}><Plus size={18}/>{t('newSession')}</Button>}/>
    <div className="toolbar"><div className="tabs">{['all','approved','pending'].map(k => <button key={k} className={filter === k ? 'active' : ''} onClick={() => setFilter(k)}>{t(k)}</button>)}</div><label className="search"><Search size={17}/><input aria-label={t('search')} placeholder={t('search')} value={search} onChange={e => setSearch(e.target.value)}/></label></div>
    {filtered.length === 0 ? <div className="panel"><Empty text="noSessions"/></div> : <div className="session-grid">{filtered.map(s => <article className="session-card" key={s._id}><div className="session-card-top"><span className="session-icon"><CalendarDays size={23}/></span><Badge value={s.participations[0]?.status || 'pending'}/></div><h2>{s.title}</h2><p className="session-date">{date(s.startAt)} <span>·</span> {time(s.startAt)}–{time(s.endAt)}</p><p className="muted icon-text"><MapPin size={15}/>{s.room || '—'}</p><div className="session-card-foot"><span className="muted icon-text"><Users size={16}/>{s.participations.reduce((n,p) => n + p.studentIds.length,0)}</span><button onClick={() => go(`sessions/${s._id}`)}>{t('view')}<ArrowUpRight size={16}/></button></div></article>)}</div>}
    {creating && <SessionForm onClose={() => setCreating(false)}/>}
  </>;
}

function ObservationView({ observation }) {
  const { t, date, time } = useApp();
  if (!observation) return <span className="muted">{t('unmarked')}</span>;
  return <div className="observation"><Badge value={observation.status}/><small>{observation.observerName}</small><small title={`${t('recorded')}: ${date(observation.recordedAt)} ${time(observation.recordedAt)}\n${t('received')}: ${date(observation.receivedAt)} ${time(observation.receivedAt)}`}>{t('recorded')}: {time(observation.recordedAt)}<br/>{t('received')}: {time(observation.receivedAt)}</small></div>;
}
export function AttendanceTable({ data, controls = false, onMark, onOverride }) {
  const { t, user, busy, syncing, online, queue } = useApp();
  const professors = data.professors || [];
  return data.rows.length === 0 ? <Empty text="noRoster"/> : <div className="table-scroll"><table className="attendance-table"><thead><tr><th>{t('student')}</th><th>{t('repObservation')}</th>{professors.map(p => <th key={p._id}>{p.name}<small>{t('professor')}</small></th>)}<th>{t('leaveEffect')}</th>{controls && (user.isRep || user.kind === 'professor') && <th>{t('yourObservation')}</th>}</tr></thead><tbody>{data.rows.map(row => {
    const repObservations = row.observations.filter(o => o.role === 'rep');
    const own = row.observations.find(o => o.observerId === user._id && o.role === (user.kind === 'professor' ? 'professor' : 'rep'));
    const pending = queue.filter(q => q.sessionId === data.session._id && q.studentId === row.student._id).at(-1);
    const ownStatus = pending?.status || own?.status;
    return <tr key={row.student._id}><td><strong>{row.student.name}</strong></td><td>{repObservations.length ? repObservations.map(o => <ObservationView key={o._id} observation={o}/>) : <span className="muted">{t('unmarked')}</span>}</td>{professors.map(p => <td key={p._id}><ObservationView observation={row.observations.find(o => o.observerId === p._id && o.role === 'professor')}/></td>)}<td>{row.leave ? <div className="leave-cell"><Badge value={row.leave.status}>{t(row.leave.status === 'absent' ? 'absentLeave' : 'present')}</Badge>{row.leave.override && <small>{row.leave.override.reason}</small>}{controls && row.canOverride && <button disabled={!online || busy} onClick={() => onOverride(row)}>{t('override')}</button>}</div> : <span className="muted">—</span>}</td>{controls && (user.isRep || user.kind === 'professor') && <td><div className="attendance-controls">{['present','absent'].map(status => <button key={status} title={t(status)} aria-label={`${row.student.name}: ${t(status)}`} aria-pressed={ownStatus === status} className={ownStatus === status ? status : ''} disabled={busy || syncing || !row.canObserve || (user.kind === 'professor' && !online) || Boolean(pending?.error)} onClick={() => onMark(row, status, own?.version || 0)}>{status === 'present' ? <Check size={17}/> : <X size={17}/>}<span>{t(status)}</span></button>)}</div>{pending && <small className={pending.error ? 'error-text' : 'pending-text'}>{t(pending.error ? 'reviewNeeded' : 'savedDevice')}</small>}</td>}</tr>;
  })}</tbody></table></div>;
}

export function SessionDetail({ sessionId }) {
  const { t, user, online, revision, run, flash, refresh, date, time, go, directory, queue, setQueue, doSync, busy, syncing } = useApp();
  const [data, setData] = useState(null); const [error, setError] = useState(null); const [rosterOpen, setRosterOpen] = useState(false); const [revisionOpen, setRevisionOpen] = useState(false); const [overrideRow, setOverrideRow] = useState(null);
  useEffect(() => {
    let alive = true; setError(null); setData(null);
    (async () => {
      try {
        let value;
        if (online) value = await api(`/sessions/${sessionId}`);
        else if (user.isRep) value = await cache.get(`${user._id}:session:${sessionId}`);
        if (!value) throw new Error('offlineUnavailable');
        if (alive) setData(value);
        if (online && user.isRep && await cache.get(`${user._id}:session:${sessionId}`)) await cache.set(`${user._id}:session:${sessionId}`, value);
      } catch (e) { if (alive) setError(e); }
    })(); return () => { alive = false; };
  }, [sessionId, online, revision, user._id]);
  if (error) return <div className="panel"><Empty text={error.code || error.message}/><Button onClick={() => go('sessions')} variant="secondary">{t('back')}</Button></div>;
  if (!data) return <Loading/>;
  const s = data.session; const p = s.participations.find(p => p.cohortId === user.cohortId);
  const myQueue = queue.filter(q => q.sessionId === sessionId);
  const mark = (row, status, version) => run(async () => {
    if (user.isRep) {
      if (!await cache.get(`${user._id}:session:${sessionId}`)) await cache.set(`${user._id}:session:${sessionId}`, data);
      const result = await enqueue(user._id, sessionId, { studentId: row.student._id, status }, version); setQueue(result);
      if (online) await doSync(); else flash(t('savedDevice'));
    } else { await api(`/sessions/${sessionId}/attendance`, { method: 'PUT', body: { studentId: row.student._id, status, version, operationId: crypto.randomUUID(), recordedAt: new Date().toISOString() } }); refresh(); }
  });
  const decide = decision => run(async () => { const result = await api(`/sessions/${sessionId}/decision`, { method: 'POST', body: { decision, version: s.version } }); flash(t(result.warnings?.length ? 'overlapWarning' : 'saved')); refresh(); });
  const discard = () => run(async () => { if (!confirm(t('discardConfirm'))) return; const remaining = (await loadQueue(user._id)).filter(q => q.sessionId !== sessionId); await cache.set(queueKey(user._id), remaining); setQueue(remaining); refresh(); });
  return <><button className="back-link" onClick={() => go('sessions')}><ArrowLeft size={16}/>{t('sessions')}</button><PageTitle title={s.title} subtitle={`${date(s.startAt)} · ${time(s.startAt)}–${time(s.endAt)} · ${s.room || t('teaching')}`} action={user.isRep && online && <Button variant="secondary" onClick={() => run(async () => { await cache.set(`${user._id}:session:${sessionId}`, data); flash(t('downloaded')); })}><Download size={17}/>{t('download')}</Button>}/>
    <section className="panel session-summary"><div><span className="eyebrow">{t('professors')}</span><p>{data.professors.map(p => p.name).join(' · ')}</p>{s.description && <p className="muted">{s.description}</p>}<small className="muted">{t('revision')} {s.revision}</small></div>{p && <div className="approval-block"><div><span>{t('scheduleApproval')}</span><Badge value={p.status}/></div><small className="muted">{t(p.confirmed ? 'rosterConfirmed' : 'rosterUnconfirmed')}</small>{user.kind === 'admin' && p.status === 'pending' && <div className="button-row"><Button disabled={!online || busy} onClick={() => decide('approve')}>{t('approve')}</Button><Button variant="danger" disabled={!online || busy} onClick={() => decide('reject')}>{t('reject')}</Button></div>}</div>}</section>
    <section className="panel"><div className="section-head"><div><h2>{t('attendance')}</h2><p>{t('attendanceSub')}</p></div><div className="button-row">{(user.isRep || user.kind === 'admin') && p?.status !== 'superseded' && <Button variant="secondary" disabled={!online || busy} onClick={() => setRosterOpen(true)}><Users size={16}/>{t('confirmRoster')}</Button>}<button className="icon-button" disabled={busy || syncing} onClick={refresh} aria-label={t('refresh')}><RefreshCw size={18}/></button></div></div><AttendanceTable data={data} controls onMark={mark} onOverride={setOverrideRow}/></section>
    {myQueue.length > 0 && <div className="notice warning"><span>{myQueue.length} {t('queued')}{myQueue.find(q => q.error) && ` · ${t(myQueue.find(q => q.error).error)}`}</span><Button variant="ghost" onClick={discard} disabled={busy || syncing || !online}>{t('discard')}</Button></div>}
    {(user.isRep || user.kind === 'admin') && s.ownerCohortId === user.cohortId && !s.nextProposalId && new Date(s.startAt) > new Date() && <Button variant="ghost" disabled={!online} onClick={() => setRevisionOpen(true)}>{t('reviseSession')}</Button>}
    {rosterOpen && <RosterModal session={s} participation={p} onClose={() => setRosterOpen(false)}/>}
    {revisionOpen && <SessionForm original={s} onClose={() => setRevisionOpen(false)}/>}
    {overrideRow && <Modal title={t('override')} onClose={() => setOverrideRow(null)}><p>{overrideRow.student.name}</p><form onSubmit={e => { e.preventDefault(); const values = Object.fromEntries(new FormData(e.currentTarget)); run(async () => { await api(`/sessions/${sessionId}/leave-override`, { method: 'PUT', body: { ...values, studentId: overrideRow.student._id } }); setOverrideRow(null); refresh(); }); }}><Field label={t('status')}><select name="status" defaultValue={overrideRow.leave.status}><option value="present">{t('present')}</option><option value="absent">{t('absent')}</option></select></Field><Field label={t('overrideReason')}><textarea name="reason" required minLength={2} maxLength={1000}/></Field><FormActions onCancel={() => setOverrideRow(null)}/></form></Modal>}
  </>;
}

function RosterModal({ session, participation, onClose }) {
  const { t, directory, run, refresh, flash } = useApp(); const [selected, setSelected] = useState(participation?.studentIds || []);
  return <Modal title={t('confirmRoster')} onClose={onClose}><p className="muted">{t('chooseResidents')}</p><form onSubmit={e => { e.preventDefault(); run(async () => { await api(`/sessions/${session._id}/roster`, { method: 'PUT', body: { studentIds: selected, version: session.version } }); flash(t('saved')); refresh(); onClose(); }); }}><div className="roster-picker">{directory.students.map(s => <label key={s._id} className="check-option"><input type="checkbox" checked={selected.includes(s._id)} onChange={() => setSelected(selected.includes(s._id) ? selected.filter(id => id !== s._id) : [...selected, s._id])}/>{s.name}{s.isRep && <Badge value="rep"/>}</label>)}</div><FormActions onCancel={onClose}/></form></Modal>;
}
