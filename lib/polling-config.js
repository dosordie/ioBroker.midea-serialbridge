'use strict';

const POLLING_METHODS = [
  {
    id: 'getStatus',
    defaultEnabled: true,
    defaultInterval: 60,
  },
  {
    id: 'getCapabilities',
    defaultEnabled: false,
    defaultInterval: 3600,
  },
  {
    id: 'getPowerUsage',
    defaultEnabled: false,
    defaultInterval: 300,
  },
  {
    id: 'getGroup5Data',
    defaultEnabled: false,
    defaultInterval: 300,
  },
];

const POLLING_METHOD_MAP = new Map(POLLING_METHODS.map((entry) => [entry.id, entry]));

function normalizeBooleanValue(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return value === true || value === 1;
}

function normalizePollingEnabled(value, fallback) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 0 || value === 1 || typeof value === 'string') {
    return normalizeBooleanValue(value);
  }
  return fallback;
}

function normalizePollingInterval(value, fallback) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.min(Math.max(Math.round(numericValue), 5), 3600);
}

function describePollingEntries(entries) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return 'none';
  }

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return 'invalid';
      }
      return `${entry.id || 'missing-id'}=${entry.enabled}/${entry.interval}s`;
    })
    .join(', ');
}

function normalizePollingRequests(config = {}) {
  const topLevelRequests = Array.isArray(config.pollingRequests) ? config.pollingRequests : null;
  const legacyRequests =
    config.polling && typeof config.polling === 'object' && Array.isArray(config.polling.requests)
      ? config.polling.requests
      : null;
  const sourceRequests =
    topLevelRequests && topLevelRequests.length > 0 ? topLevelRequests : legacyRequests || [];
  const configuredById = new Map();

  for (const entry of sourceRequests) {
    if (!entry || typeof entry !== 'object' || !POLLING_METHOD_MAP.has(entry.id)) {
      continue;
    }
    if (configuredById.has(entry.id)) {
      continue;
    }

    const method = POLLING_METHOD_MAP.get(entry.id);
    configuredById.set(entry.id, {
      id: entry.id,
      enabled: normalizePollingEnabled(entry.enabled, method.defaultEnabled),
      interval: normalizePollingInterval(entry.interval, method.defaultInterval),
    });
  }

  return POLLING_METHODS.map((method) => {
    const configuredEntry = configuredById.get(method.id);
    return configuredEntry
      ? { ...configuredEntry }
      : {
          id: method.id,
          enabled: method.defaultEnabled,
          interval: method.defaultInterval,
        };
  });
}

module.exports = {
  POLLING_METHODS,
  POLLING_METHOD_MAP,
  describePollingEntries,
  normalizeBooleanValue,
  normalizePollingRequests,
};
