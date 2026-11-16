const minute = 60_000;
const maxTimer = 2_147_483_647;

function wait(milliseconds, signal) {
  return new Promise(resolve => {
    const timer = setTimeout(finish, milliseconds);
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    }
    signal.addEventListener('abort', finish, { once: true });
  });
}

export async function requestWithAiHold(request, { signal, onStatus, waitFor = wait }) {
  let holds = 0;
  while (true) {
    signal.throwIfAborted();
    const result = await request();
    signal.throwIfAborted();
    if (result?.kind !== 'hold') return result;

    const interval = result.reason === 'credits' ? 5 * minute : minute * Math.min(2 ** holds, 15);
    const delay = Math.max(1000, result.retryMs ?? interval);
    const retryAt = Date.now() + delay;
    const time = new Date(retryAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' });
    onStatus(result.reason === 'credits'
      ? `On hold · ${result.provider} credits or spending limit. Checking again at ${time}.`
      : `On hold · ${result.provider} rate limit. Retrying at ${time}.`);
    for (let remaining = delay; remaining > 0; remaining = retryAt - Date.now()) {
      signal.throwIfAborted();
      await waitFor(Math.min(remaining, maxTimer), signal);
      signal.throwIfAborted();
    }
    holds++;
    onStatus('Resuming…');
  }
}
