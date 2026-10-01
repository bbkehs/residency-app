import React, { useEffect, useState } from 'react';
import { BellRing } from 'lucide-react';
import { api } from './api';
import { useApp, Button } from './ui';
import { supportsPush, enablePush, disablePush, pushState } from './push-client';

export function PushSettings() {
  const { user, lang, t, online, run, busy, flash } = useApp();
  const [config, setConfig] = useState(null); const [enabled, setEnabled] = useState(false); const [error, setError] = useState(null); const [loaded, setLoaded] = useState(false);
  const supported = supportsPush();
  const permission = supported ? Notification.permission : 'unsupported';
  useEffect(() => {
    let alive = true; setError(null); setLoaded(false);
    (async () => {
      if (!supported || !online) { if (alive) setLoaded(true); return; }
      try {
        const [settings, current] = await Promise.all([api('/push/config'), api('/push/subscriptions/current')]);
        const registration = await navigator.serviceWorker.getRegistration();
        const local = await registration?.pushManager.getSubscription();
        const context = await pushState.read();
        if (!alive) return;
        setConfig(settings); setEnabled(Boolean(permission === 'granted' && local && current.subscription && context?.userId === user._id && context.subscriptionId === current.subscription._id && current.subscription.publicKey === settings.publicKey));
      } catch (e) { if (alive) setError(e.code || 'requestFailed'); }
      finally { if (alive) setLoaded(true); }
    })();
    return () => { alive = false; };
  }, [user._id, online, supported]);
  const explanation = !supported ? 'PUSH_UNSUPPORTED' : !online ? 'offlineUnavailable' : !loaded ? 'loading' : error || (!config?.configured ? 'PUSH_NOT_CONFIGURED' : permission === 'denied' ? 'PUSH_PERMISSION_DENIED' : enabled ? 'pushEnabledNote' : 'pushPrivacy');
  return <section className="push-settings" aria-label={t('browserNotifications')}><div><BellRing size={20}/><h3>{t('browserNotifications')}</h3></div><p>{t(explanation)}</p>{supported && online && loaded && !error && config?.configured && <Button variant={enabled ? 'secondary' : 'primary'} disabled={busy || (!enabled && permission === 'denied')} onClick={() => run(async () => {
    if (enabled) { setEnabled(false); await disablePush(); flash(t('pushDisabled')); }
    else { await enablePush(user, lang, config); setEnabled(true); flash(t('pushEnabled')); }
  })}>{t(enabled ? 'disablePush' : 'enablePush')}</Button>}</section>;
}
