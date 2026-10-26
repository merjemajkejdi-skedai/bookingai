// Run: npx tsx src/escalation/fallback.test.ts
import {
  classifyTwilioStatus, chooseNotice, buildNoticePrompt, DEFAULT_NOTICE, NOTICE_SYSTEM,
  createFallback, createTimeoutJob, buildShopNotice, DEFAULT_SHOP_APOLOGY, SHOP_NOTICE_SYSTEM, type FallbackRow, type FallbackDeps, type TimeoutDeps,
} from './fallback.js';

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) { failures++; console.log(`FAIL  ${name}`, detail ?? ''); }
  else console.log(`ok    ${name}`);
}

const row = (id = 'e1'): FallbackRow => ({ id, tenant_id: 't1', tenant_type: 'hotel', conversation_id: 'c1', kind: 'question', guest_question: 'Do you offer scuba trips?', department_id: null });

(async () => {
  // Twilio statuses
  for (const s of ['sent', 'delivered', 'read', 'SENT']) check(`twilio ${s} -> ok`, classifyTwilioStatus(s) === 'ok');
  for (const s of ['failed', 'undelivered', 'canceled']) check(`twilio ${s} -> failed`, classifyTwilioStatus(s) === 'failed');
  for (const s of ['queued', 'accepted', 'sending', 'scheduled', '', null, undefined]) check(`twilio ${String(s)} -> pending`, classifyTwilioStatus(s as any) === 'pending');

  // notice choice
  const src = ['Do you offer scuba trips?'];
  check('notice: good model text is used', chooseNotice('Të falënderojmë! E kalova pyetjen te ekipi ynë.', src) === 'Të falënderojmë! E kalova pyetjen te ekipi ynë.');
  check('notice: empty -> default', chooseNotice('  ', src) === DEFAULT_NOTICE && chooseNotice(null, src) === DEFAULT_NOTICE);
  check('notice: invented number -> default', chooseNotice("They'll reply within 15 minutes.", src) === DEFAULT_NOTICE);
  check('notice: absurdly long -> default', chooseNotice('x'.repeat(401), src) === DEFAULT_NOTICE);
  check('notice: prompt wraps data and forbids promises', buildNoticePrompt('Q?', [{ role: 'user', content: 'hi' }]).includes('<guest_question>\nQ?\n</guest_question>') && NOTICE_SYSTEM.includes('Do not promise'));

  // shop note: honest apology + deterministic contact lines
  const lines = ['📱 +355 69 000 0000', 'Instagram: https://instagram.com/bloom'];
  check('shop note: model apology then the shop contact lines', buildShopNotice('Më vjen keq, nuk e mora dot përgjigjen.', src, lines) === 'Më vjen keq, nuk e mora dot përgjigjen.\n📱 +355 69 000 0000\nInstagram: https://instagram.com/bloom');
  check('shop note: unsafe model text -> default apology, contact lines kept', buildShopNotice('Someone will call you within 10 minutes.', src, lines).startsWith(DEFAULT_SHOP_APOLOGY) && buildShopNotice('Someone will call you within 10 minutes.', src, lines).endsWith('instagram.com/bloom'));
  check('shop note: no contact details -> apology alone', buildShopNotice(null, src, []) === DEFAULT_SHOP_APOLOGY);
  check('shop note: phone digits in the contact lines never trip the number guard', buildShopNotice('Sorry about that.', src, lines).includes('+355 69 000 0000'));
  check('shop note never says it was passed on', !/passed|get back to you/i.test(DEFAULT_SHOP_APOLOGY) && SHOP_NOTICE_SYSTEM.includes('Do not promise that anyone will get back'));

  // fallback
  function fb(over: Partial<FallbackDeps> = {}) {
    const events: string[] = []; const errors: string[] = [];
    const deps: FallbackDeps = {
      createRequest: async r => { events.push(`request:${r.id}`); },
      notifyGuest: async r => { events.push(`notify:${r.id}`); },
      recordError: async (_id, e) => { errors.push(e); },
      ...over,
    };
    return { run: createFallback(deps), events, errors };
  }
  { const h = fb(); const r = await h.run(row());
    check('fallback: request first, then the guest is told', r.requestCreated && r.guestNotified && h.events.join() === 'request:e1,notify:e1' && h.errors.length === 0, h); }
  { const h = fb({ createRequest: async () => { throw new Error('db down'); } }); const r = await h.run(row());
    check('fallback: no request -> guest is NOT told it was passed on, error recorded', !r.requestCreated && !r.guestNotified && !h.events.includes('notify:e1') && h.errors[0].startsWith('fallback_request_failed'), h); }
  { const h = fb({ notifyGuest: async () => { throw new Error('window closed'); } }); const r = await h.run(row());
    check('fallback: request kept even if the guest note fails, error recorded', r.requestCreated && !r.guestNotified && h.errors[0].startsWith('fallback_notice_failed'), h); }
  { const h = fb({ createRequest: async () => { throw new Error('x'); }, recordError: async () => { throw new Error('also down'); } }); const r = await h.run(row());
    check('fallback: even recording the error failing does not throw', !r.requestCreated, h); }

  // job
  function job(over: Partial<TimeoutDeps> = {}, expired: FallbackRow[] = [], failedAlerts: FallbackRow[] = []) {
    const done: string[] = [];
    const deps: TimeoutDeps = {
      claimExpired: async () => expired,
      claimFailedAlerts: async () => failedAlerts,
      fallback: async r => { done.push(r.id); return { requestCreated: true, guestNotified: true }; },
      ...over,
    };
    return { run: createTimeoutJob(deps), done };
  }
  { const h = job({}, [row('a'), row('b')], [row('c')]); const r = await h.run();
    check('job: failed alerts and expired escalations all fall back (alerts first)', h.done.join() === 'c,a,b' && r.failedAlerts === 1 && r.expired === 2, { done: h.done, r }); }
  { const h = job(); const r = await h.run();
    check('job: nothing due -> nothing happens', h.done.length === 0 && r.expired === 0 && r.failedAlerts === 0); }
  { const done: string[] = [];
    const h = job({ fallback: async r => { done.push(r.id); if (r.id === 'a') throw new Error('boom'); return { requestCreated: true, guestNotified: true }; } }, [row('a'), row('b')]);
    await h.run();
    check('job: one escalation crashing does not block the next', done.join() === 'a,b', done); }
  { const done: string[] = [];
    const h = job({ claimFailedAlerts: async () => { throw new Error('twilio down'); }, fallback: async r => { done.push(r.id); return { requestCreated: true, guestNotified: true }; } }, [row('a')]);
    const r = await h.run();
    check('job: Twilio status check failing still processes expired ones', done.join() === 'a' && r.expired === 1 && r.failedAlerts === 0, { done, r }); }
  { const done: string[] = [];
    const h = job({ claimExpired: async () => { throw new Error('db hiccup'); }, fallback: async r => { done.push(r.id); return { requestCreated: true, guestNotified: true }; } }, [], [row('c')]);
    const r = await h.run();
    check('job: expiry claim failing still processes failed alerts, never throws', done.join() === 'c' && r.failedAlerts === 1, { done, r }); }

  console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
