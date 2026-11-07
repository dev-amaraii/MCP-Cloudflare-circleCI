/**
 * Conservative provider selection. No CircleCI credits/balance API is relied upon:
 * only a time-bounded, operator-verified exhaustion signal may change routing.
 * Never retry a submitted CircleCI pipeline on another provider.
 */
const MAX_SIGNAL_WINDOW_MS=32*24*60*60*1000;

export function selectProvider(env, command, now=Date.now()) {
  if (command.project !== 'amaraii-os' || command.branch !== 'development' ||
      command.mode !== 'validation') throw new Error('Automatic CI route not permitted');
  if (env.CI_AUTO_ROUTING_ENABLED !== 'true')
    throw new Error('Automatic CI routing disabled');
  const marker=env.CI_CIRCLECI_EXHAUSTED_UNTIL;
  if (marker===undefined || marker==='') {
    return {provider:'circleci',reason:'no_confirmed_exhaustion',automaticFallback:false};
  }
  if (typeof marker!=='string' ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(marker)) {
    throw new Error('Invalid CircleCI exhaustion marker');
  }
  const until=Date.parse(marker);
  if (!Number.isFinite(until) || until>now+MAX_SIGNAL_WINDOW_MS) {
    throw new Error('Invalid CircleCI exhaustion marker');
  }
  if (until<=now) {
    return {provider:'circleci',reason:'exhaustion_marker_expired',automaticFallback:false};
  }
  if (env.CI_SEMAPHORE_FALLBACK_ENABLED!=='true') {
    throw new Error('Semaphore fallback not enabled');
  }
  return {provider:'semaphore',reason:'confirmed_circleci_exhaustion',
    automaticFallback:true,exhaustionExpiresAt:marker};
}
