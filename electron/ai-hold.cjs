const minute = 60_000;

function resetDelay(value, now) {
  if (!value) return null;
  if (/^\d+(?:\.\d+)?$/.test(value)) return Math.ceil(Number(value) * 1000);
  if (/^(?:\d+(?:\.\d+)?(?:ms|[dhms]))+$/.test(value)) {
    const units = { d: 24 * 60 * minute, h: 60 * minute, m: minute, s: 1000, ms: 1 };
    return Math.ceil(Array.from(value.matchAll(/(\d+(?:\.\d+)?)(ms|[dhms])/g),
      ([, amount, unit]) => Number(amount) * units[unit]).reduce((total, duration) => total + duration, 0));
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

function providerError(error, data, status, response) {
  error.status = status;
  const detail = data?.error;
  const code = detail?.details?.error_code || detail?.code || detail?.type || '';
  const message = typeof detail === 'string' ? detail : detail?.message || '';
  const billing = status === 402 ||
    /^(?:insufficient_quota|billing_hard_limit_reached|insufficient_credits|blocked_api_access|enforced_spend_limit_reached|(?:organization|project)_(?:spend|usage)_limit_exceeded)$/.test(code) ||
    ([400, 403, 429].includes(status) && /(?:credit balance is too low|insufficient (?:funds|credits|balance|quota)|(?:run out of|no remaining) (?:api )?credits|monthly (?:api )?(?:usage threshold|spend cap)|spend(?:ing)? limit (?:has been )?(?:reached|exceeded))/.test(message.toLowerCase()));
  if (status !== 429 && !billing && code !== 'rate_limit_exceeded') return error;

  const now = Date.now();
  const get = name => response?.headers?.get?.(name);
  const retryAfter = resetDelay(get('retry-after'), now);
  const resetTimes = ['requests', 'tokens', 'project-tokens', 'input-tokens', 'output-tokens'].flatMap(resource => [
    ['x-ratelimit-remaining-' + resource, 'x-ratelimit-reset-' + resource],
    ['anthropic-ratelimit-' + resource + '-remaining', 'anthropic-ratelimit-' + resource + '-reset'],
  ]).filter(([remaining]) => get(remaining) != null && Number(get(remaining)) === 0)
    .map(([, reset]) => resetDelay(get(reset), now)).filter(value => value > 0);
  const retryMs = retryAfter ?? (!billing && resetTimes.length ? Math.max(...resetTimes) : null);
  error.aiHold = { reason: billing ? 'credits' : 'rate-limit', retryMs: Number.isFinite(retryMs) ? retryMs : null };
  return error;
}

function aiHoldResponse(error, config) {
  if (!error.aiHold) return null;
  return { kind: 'hold', provider: config.name, ...error.aiHold };
}

module.exports = { providerError, aiHoldResponse };
