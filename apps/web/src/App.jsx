import React, { useCallback, useEffect, useState } from 'react';
import { LayoutDashboard, CalendarDays, CalendarCheck, Users, ClipboardList, MessagesSquare, History, Bell, LogOut, Languages, Menu, X, WifiOff, RefreshCw, ArrowUpRight, Plus, GraduationCap, ShieldCheck } from 'lucide-react';
import { api, setCsrf } from './api';
import { cache, loadQueue, syncQueue } from './offline';
import { translate } from './i18n';
import { AppContext, Button, Field, FormActions, Loading, Modal, Empty, Badge, PageTitle } from './ui';
import { SessionsPage, SessionDetail, SessionForm } from './sessions';
import { LeavePage, PeoplePage, MessagesPage, ReportsPage, AuditPage, PasswordForm } from './pages';

export default function App() {
  const [lang, setLang] = useState(localStorage.getItem('language') || 'en'); const t = translate(lang);
  const [user, setUser] = useState(null); const [ready, setReady] = useState(false);
  const [online, setOnline] = useState(navigator.onLine); const [busy, setBusy] = useState(false); const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState(null); const [revision, setRevision] = useState(0); const [queue, setQueue] = useState([]);
  const [directory, setDirectory] = useState({ professors: [], cohorts: [], students: [] }); const [sessions, setSessions] = useState([]); const [notifications, setNotifications] = useState([]);
  const [bootstrapError, setBootstrapError] = useState(null); const [booting, setBooting] = useState(false);
  const [route, setRoute] = useState(location.hash.slice(1) || 'overview'); const [menu, setMenu] = useState(false); const [drawer, setDrawer] = useState(false); const [passwordOpen, setPasswordOpen] = useState(false);
  const go = path => { location.hash = path; setMenu(false); };
  const flash = (message, error = false) => setToast({ message, error, key: Date.now() });
  const refresh = () => setRevision(v => v + 1);
  const date = value => new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR-u-ca-persian' : 'en-GB-u-ca-persian', { timeZone: 'Asia/Tehran', day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
  const time = value => new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
  const run = async fn => {
    setBusy(true);
    try { return await fn(); } catch (e) { flash(t(e.code || e.message || 'requestFailed'), true); if (e.code === 'NETWORK_ERROR') setOnline(false); if (e.status === 401 && e.code !== 'INVALID_CREDENTIALS') { setUser(null); await cache.clear(); } }
    finally { setBusy(false); }
  };
  async function signedIn(auth) {
    const old = await cache.get('profile');
    if (old && old._id !== auth.user._id) await cache.clear();
    setCsrf(auth.csrf); setUser(auth.user); localStorage.removeItem('logout-pending'); setOnline(true); setReady(true); go('overview');
    if (auth.user.isRep) await cache.set('profile', auth.user); else await cache.delete('profile');
  }
  useEffect(() => { document.documentElement.lang = lang; document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr'; localStorage.setItem('language', lang); }, [lang]);
  useEffect(() => { if (!toast) return; const timer = setTimeout(() => setToast(null), 6500); return () => clearTimeout(timer); }, [toast]);
  useEffect(() => {
    const onRoute = () => setRoute(location.hash.slice(1) || 'overview'); const onOnline = () => { setOnline(true); refresh(); }; const onOffline = () => setOnline(false);
    addEventListener('hashchange', onRoute); addEventListener('online', onOnline); addEventListener('offline', onOffline);
    return () => { removeEventListener('hashchange', onRoute); removeEventListener('online', onOnline); removeEventListener('offline', onOffline); };
  }, []);
  useEffect(() => {
    (async () => {
      try {
        const auth = await api('/auth/me');
        if (localStorage.getItem('logout-pending')) { setCsrf(auth.csrf); await api('/auth/logout', { method: 'POST', body: {} }); localStorage.removeItem('logout-pending'); await cache.clear(); }
        else { setCsrf(auth.csrf); setUser(auth.user); if (auth.user.isRep) await cache.set('profile', auth.user); else await cache.delete('profile'); }
      } catch (e) {
        if (e.code === 'NETWORK_ERROR') { setOnline(false); if (!localStorage.getItem('logout-pending')) { const saved = await cache.get('profile'); if (saved?.isRep) setUser(saved); } }
        else if (e.status === 401) { await cache.clear(); localStorage.removeItem('logout-pending'); }
        else flash(t(e.code || 'requestFailed'), true);
      } finally { setReady(true); }
    })().catch(() => { setReady(true); flash(t('requestFailed'), true); });
  }, []);
  useEffect(() => {
    if (!user || user.mustChangePassword) return;
    let alive = true; setBooting(true); setBootstrapError(null);
    (async () => {
      try {
        if (!online) {
          if (user.isRep) { const [d, s] = await Promise.all([cache.get(`${user._id}:directory`), cache.get(`${user._id}:sessions`)]); if (alive) { setDirectory(d || { professors: [], cohorts: [], students: [] }); setSessions(s || []); } }
          return;
        }
        const auth = await api('/auth/me'); if (!alive) return; setCsrf(auth.csrf); setUser(auth.user);
        const [d, s, n] = await Promise.all([api('/directory'), api('/sessions'), api('/notifications')]);
        if (!alive) return; setDirectory(d); setSessions(s); setNotifications(n);
        if (auth.user.isRep) { await cache.set('profile', auth.user); await cache.set(`${user._id}:directory`, d); await cache.set(`${user._id}:sessions`, s); }
        else await cache.clear();
      } catch (e) { if (alive) { setBootstrapError(e); if (e.code === 'NETWORK_ERROR') setOnline(false); if (e.status === 401) { await cache.clear(); setUser(null); } } }
      finally { if (alive) setBooting(false); }
    })();
    return () => { alive = false; };
  }, [user?._id, user?.mustChangePassword, online, revision]);
  const doSync = useCallback(async () => {
    if (!user?.isRep || !online) return;
    setSyncing(true);
    try {
      // Offline reload intentionally has no CSRF credential. Reauthenticate before replay.
      const auth = await api('/auth/me'); setCsrf(auth.csrf);
      if (auth.user._id !== user._id || !auth.user.isRep) {
        await cache.clear(); setQueue([]); setUser(auth.user); flash(t('ACCOUNT_CHANGED'), true); return;
      }
      setUser(auth.user);
      const result = await syncQueue(user._id); setQueue(result); if (result.some(x => x.error)) flash(t('reviewNeeded'), true); else refresh();
    }
    catch (e) { if (e.code === 'NETWORK_ERROR') setOnline(false); else { flash(t(e.code || 'requestFailed'), true); if (e.status === 401) { await cache.clear(); setUser(null); } } }
    finally { setQueue(await loadQueue(user._id)); setSyncing(false); }
  }, [user?._id, user?.isRep, online, lang]);
  useEffect(() => { if (user?.isRep) { loadQueue(user._id).then(setQueue); if (online) doSync(); } }, [user?._id, user?.isRep, online]);
  async function logout() {
    if (queue.length && !confirm(t('logoutConfirm'))) return;
    await run(async () => {
      localStorage.setItem('logout-pending', '1');
      try { await api('/auth/logout', { method: 'POST', body: {} }); localStorage.removeItem('logout-pending'); } catch (e) { if (e.status === 401) localStorage.removeItem('logout-pending'); else if (e.code !== 'NETWORK_ERROR') throw e; }
      await cache.clear(); setCsrf(''); setUser(null); setQueue([]); setSessions([]); setNotifications([]); go('overview');
    });
  }
  const context = { user, setUser, t, lang, online, busy, syncing, run, flash, refresh, revision, directory, sessions, queue, setQueue, doSync, go, date, time, signedIn };
  const nav = [{ key: 'overview', icon: LayoutDashboard }, { key: 'sessions', icon: CalendarDays }, { key: 'leave', icon: CalendarCheck }, ...((user?.kind === 'admin' || user?.isRep) ? [{ key: 'residents', icon: Users }] : []), { key: 'reports', icon: ClipboardList }, ...(['admin', 'professor'].includes(user?.kind) ? [{ key: 'messages', icon: MessagesSquare }] : []), ...(user?.kind === 'admin' ? [{ key: 'activity', icon: History }] : [])];
  return <AppContext.Provider value={context}>
    {!ready ? <div className="fullscreen"><Loading/></div> : !user ? <Auth onSigned={signedIn} lang={lang} setLang={setLang}/> : user.mustChangePassword ? <div className="fullscreen"><div className="auth-card"><h1>{t('passwordChange')}</h1><p>{t('passwordChangeNote')}</p><PasswordForm forced/><Button variant="ghost" onClick={logout}>{t('logout')}</Button></div></div> : <div className="shell">
      {menu && <button className="sidebar-scrim" onClick={() => setMenu(false)} aria-label={t('close')}/>}
      <aside className={`sidebar ${menu ? 'open' : ''}`}><a href="#overview" className="brand"><img src="/icon.svg" alt=""/><span>{t('brand')}<small>{t('residency')}</small></span></a>
        <div className="workspace-label">{t('yourWorkspace')}</div><nav>{nav.map(({ key, icon: Icon }) => <a key={key} href={`#${key}`} onClick={() => setMenu(false)} className={route.split('/')[0] === key ? 'selected' : ''}><Icon size={19}/>{t(key)}{key === 'sessions' && <span className="nav-count">{sessions.length}</span>}</a>)}</nav>
        <div className="scope-card"><ShieldCheck size={21}/><strong>{lang === 'fa' ? directory.department?.nameFa : directory.department?.code}</strong><small>{user.cohortId ? `${t('year')} ${directory.cohorts.find(c => c._id === user.cohortId)?.year || ''}` : t('professor')}</small></div>
        <button className="profile-button" onClick={() => setPasswordOpen(true)}><span className="avatar">{user.name.slice(0, 1)}</span><span><strong>{user.name}</strong><small>{t(user.isRep ? 'rep' : user.kind)}</small></span></button><button className="logout" onClick={logout} disabled={busy || syncing}><LogOut size={17}/>{t('logout')}</button>
      </aside>
      <div className="main-column"><header className="topbar"><div className="topbar-left"><button className="icon-button mobile-menu" onClick={() => setMenu(true)} aria-label={t('yourWorkspace')}><Menu/></button><span className="breadcrumb">{t('residency')}<span>/</span><strong>{t(route.split('/')[0])}</strong></span></div><div className="topbar-actions"><span className={`connection ${online ? '' : 'disconnected'}`}><i/>{t(online ? 'online' : 'offline')}</span><button className="icon-button" onClick={() => setLang(lang === 'en' ? 'fa' : 'en')} aria-label={lang === 'en' ? 'فارسی' : 'English'}><Languages size={19}/><span>{lang === 'en' ? 'FA' : 'EN'}</span></button><button className="icon-button notification-bell" onClick={() => setDrawer(true)} aria-label={t('notifications')}><Bell size={20}/>{notifications.some(n => !n.readAt) && <i/>}</button></div></header>
        <main>{!online && <div className="notice"><WifiOff size={18}/>{t('offlineNote')}<Button variant="ghost" onClick={() => { setOnline(true); refresh(); }}>{t('refresh')}</Button></div>}
          {user.isRep && queue.length > 0 && <div className={`notice ${queue.some(q => q.error) ? 'warning' : ''}`}><RefreshCw size={18}/><span>{queue.length} {t('queued')}{queue.some(q => q.error) ? ` · ${t('reviewNeeded')}` : ''}</span><Button variant="ghost" onClick={doSync} disabled={!online || busy || syncing}>{t(syncing ? 'syncing' : 'sync')}</Button></div>}
          {bootstrapError && online ? <div className="error-panel">{t(bootstrapError.code || 'requestFailed')}<Button onClick={refresh}>{t('refresh')}</Button></div> : booting && sessions.length === 0 ? <Loading/> : route === 'overview' ? <Overview/> : route === 'sessions' ? <SessionsPage/> : route.startsWith('sessions/') ? <SessionDetail sessionId={route.split('/')[1]}/> : route === 'leave' ? <LeavePage/> : route === 'residents' ? <PeoplePage/> : route === 'reports' ? <ReportsPage/> : route === 'messages' ? <MessagesPage/> : route === 'activity' ? <AuditPage/> : <Empty/>}
        </main><footer>{t('brand')}<span>{date(new Date())} · {t(user.isRep ? 'rep' : user.kind)}</span></footer>
      </div>
      {drawer && <Modal title={t('notifications')} onClose={() => setDrawer(false)}>{notifications.length === 0 ? <Empty text="noNotifications"/> : <div className="notification-list">{notifications.map(n => <div className={n.readAt ? '' : 'unread'} key={n._id}><Bell size={18}/><div><strong>{t(n.type)}</strong><small>{date(n.createdAt)} · {time(n.createdAt)}</small></div>{!n.readAt && <Button variant="ghost" disabled={!online || busy} onClick={() => run(async () => { await api(`/notifications/${n._id}/read`, { method: 'POST', body: {} }); refresh(); })}>{t('markRead')}</Button>}</div>)}</div>}</Modal>}
      {passwordOpen && <Modal title={t('passwordChange')} onClose={() => setPasswordOpen(false)}><PasswordForm onDone={() => setPasswordOpen(false)}/></Modal>}
    </div>}
    {toast && <div key={toast.key} className={`toast ${toast.error ? 'error' : ''}`} role={toast.error ? 'alert' : 'status'}><span>{toast.message}</span><button aria-label={t('close')} onClick={() => setToast(null)}><X size={17}/></button></div>}
  </AppContext.Provider>;
}

function Auth({ onSigned, lang, setLang }) {
  const { t, run, busy, flash } = React.useContext(AppContext); const [signup, setSignup] = useState(false); const [catalog, setCatalog] = useState({ departments: [], cohorts: [] }); const [department, setDepartment] = useState('');
  useEffect(() => { api('/auth/catalog').then(v => { setCatalog(v); setDepartment(v.departments[0]?._id || ''); }).catch(e => flash(t(e.code || 'requestFailed'), true)); }, []);
  const submit = e => { e.preventDefault(); const form = Object.fromEntries(new FormData(e.currentTarget)); run(async () => { if (signup) { await api('/auth/signup', { method: 'POST', body: form }); flash(t('signupSuccess')); setSignup(false); } else await onSigned(await api('/auth/login', { method: 'POST', body: form })); }); };
  return <div className="auth-layout"><div className="auth-story"><a className="brand" href="#"><img src="/icon.svg" alt=""/><span>{t('brand')}<small>{t('residency')}</small></span></a><div className="story-content"><span className="eyebrow">{t('teaching')}</span><h1>{t('loginTitle')}</h1><p>{t('loginSub')}</p><div className="story-art" aria-hidden="true"><div className="orbit one"/><div className="orbit two"/><div className="art-card"><GraduationCap size={42}/><div className="art-line"/><div className="art-line short"/><div className="art-dots"><i/><i/><i/><i/></div></div><span className="art-check"><ShieldCheck size={27}/></span></div></div><p className="story-bottom">{t('loginNote')}</p></div><div className="auth-form-side"><button className="language-button" onClick={() => setLang(lang === 'en' ? 'fa' : 'en')}><Languages size={18}/>{lang === 'en' ? 'فارسی' : 'English'}</button><div className="auth-card"><span className="eyebrow">{t('yourWorkspace')}</span><h2>{t(signup ? 'signup' : 'login')}</h2><p>{t(signup ? 'signupNote' : 'overviewSub')}</p><form onSubmit={submit} key={signup ? 'signup' : 'login'}>
    {signup && <><Field label={t('name')}><input name="name" required minLength={2} maxLength={120} autoComplete="name"/></Field><div className="form-grid"><Field label={t('department')}><select name="departmentId" value={department} onChange={e => setDepartment(e.target.value)} required>{catalog.departments.map(d => <option key={d._id} value={d._id}>{lang === 'fa' ? d.nameFa : d.name}</option>)}</select></Field><Field label={t('cohort')}><select name="cohortId" key={department} required>{catalog.cohorts.filter(c => c.departmentId === department).map(c => <option key={c._id} value={c._id}>{t('year')} {c.year}</option>)}</select></Field></div><Field label={t('role')}><select name="kind"><option value="student">{t('student')}</option><option value="professor">{t('professor')}</option></select></Field></>}
    <Field label={t('username')} hint={signup ? t('usernameHint') : undefined}><input name="username" dir="ltr" autoComplete="username" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,39}"/></Field><Field label={t('password')} hint={signup ? t('passwordHint') : undefined}><input type="password" name="password" dir="ltr" minLength={signup ? 12 : 1} maxLength={128} autoComplete={signup ? 'new-password' : 'current-password'} required/></Field><Button className="full" disabled={busy} type="submit">{t(signup ? 'signup' : 'login')}<ArrowUpRight size={18}/></Button></form><div className="auth-switch">{t(signup ? 'existingAccount' : 'accountPrompt')} <button onClick={() => setSignup(!signup)}>{t(signup ? 'login' : 'signup')}</button></div></div></div></div>;
}

function Overview() {
  const { user, t, sessions, directory, go, date, time, online } = React.useContext(AppContext); const [creating, setCreating] = useState(false);
  const upcoming = sessions.filter(s => new Date(s.endAt) >= new Date() && s.participations.some(p => p.status === 'approved')).sort((a,b) => new Date(a.startAt) - new Date(b.startAt));
  const pending = sessions.filter(s => s.participations.some(p => p.status === 'pending'));
  return <><PageTitle title={`${t('hello')}, ${user.name.split(' ')[0]}`} subtitle={t('overviewSub')} action={(user.isRep || user.kind === 'admin') && <Button disabled={!online} onClick={() => setCreating(true)}><Plus size={18}/>{t('newSession')}</Button>}/>
    <div className="hero-banner"><div><span className="eyebrow">{t('yourWorkspace')}</span><h2>{t('welcome')}</h2><p>{date(new Date())}<span> / </span>{t(user.isRep ? 'rep' : user.kind)}</p></div><div className="hero-mark" aria-hidden="true"><GraduationCap size={70}/></div></div>
    <div className="stats"><div><span>{t('upcoming')}</span><strong>{upcoming.length}</strong><CalendarDays/></div><div><span>{t('scheduleApproval')} · {t('pending')}</span><strong>{pending.length}</strong><CalendarCheck/></div><div><span>{t(user.kind === 'admin' || user.isRep ? 'residents' : 'sessions')}</span><strong>{user.kind === 'professor' ? sessions.length : user.kind === 'admin' || user.isRep ? directory.students.length : sessions.filter(s => s.participations.some(p => p.studentIds.includes(user._id))).length}</strong><Users/></div></div>
    <section className="panel"><div className="section-head"><div><span className="eyebrow">{t('schedule')}</span><h2>{t('upcoming')}</h2></div><Button variant="ghost" onClick={() => go('sessions')}>{t('all')}<ArrowUpRight size={16}/></Button></div>{upcoming.length === 0 ? <Empty text="noSessions"/> : upcoming.slice(0,5).map(s => <button className="schedule-row" key={s._id} onClick={() => go(`sessions/${s._id}`)}><div className="date-tile"><CalendarDays size={20}/><small>{time(s.startAt)}</small></div><div className="schedule-copy"><strong>{s.title}</strong><span>{date(s.startAt)} · {s.room || t('teaching')}</span></div><Badge value="approved"/><ArrowUpRight size={18}/></button>)}</section>
    {creating && <SessionForm onClose={() => setCreating(false)}/>}
  </>;
}
