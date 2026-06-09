'use strict';

const POLLING_METHODS = [
  {
    id: 'getStatus',
    defaultEnabled: true,
    defaultInterval: 60,
    label: {
      en: 'Status request (C0)',
      de: 'Statusabfrage (C0)',
    },
  },
  {
    id: 'getCapabilities',
    defaultEnabled: false,
    defaultInterval: 3600,
    label: {
      en: 'Capabilities (B5)',
      de: 'Fähigkeiten (B5)',
    },
  },
  {
    id: 'getPowerUsage',
    defaultEnabled: false,
    defaultInterval: 300,
    label: {
      en: 'Energy counter (C1 Group 44)',
      de: 'Energiezähler (C1 Group 44)',
    },
  },
  {
    id: 'getGroup5Data',
    defaultEnabled: false,
    defaultInterval: 300,
    label: {
      en: 'Group 5 data (C1 Group 45)',
      de: 'Group-5-Daten (C1 Group 45)',
    },
  },
  {
    id: 'getGroup41Data',
    defaultEnabled: false,
    defaultInterval: 60,
    label: {
      en: 'Group 41 diagnostic data (C1 Group 41)',
      de: 'Group-41-Diagnosedaten (C1 Group 41)',
    },
  },
  {
    id: 'getGroup43Data',
    defaultEnabled: false,
    defaultInterval: 60,
    label: {
      en: 'Group 43 diagnostic data (C1 Group 43)',
      de: 'Group-43-Diagnosedaten (C1 Group 43)',
    },
  },
];

const POLLING_METHOD_MAP = new Map(POLLING_METHODS.map((entry) => [entry.id, entry]));

const UNKNOWN_GROUP_MIN = 0x20;
const UNKNOWN_GROUP_MAX = 0x7f;
const UNKNOWN_GROUP_MAX_COUNT = 16;
const UNKNOWN_GROUP_MIN_INTERVAL = 10;
const REGULAR_GROUP_BYTES = new Map([
  [0x41, 'getGroup41Data'],
  [0x43, 'getGroup43Data'],
  [0x44, 'getPowerUsage'],
  [0x45, 'getGroup5Data'],
]);

function normalizeUnknownGroupPollingInterval(value, fallback = 60) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(Math.round(numericValue), UNKNOWN_GROUP_MIN_INTERVAL);
}

function extractUnknownGroupTokens(value) {
  if (value === null || value === undefined || value === '') {
    return [];
  }

  if (typeof value === 'number' || typeof value === 'bigint') {
    return [String(value)];
  }

  if (typeof value === 'string') {
    return value
      .split(/[\s,;]+/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  if (Array.isArray(value)) {
    const tokens = [];
    for (const entry of value) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
        const candidate =
          entry.groupByte ?? entry.groupId ?? entry.group ?? entry.id ?? entry.value ?? entry.byte;
        tokens.push(...extractUnknownGroupTokens(candidate));
      } else {
        tokens.push(...extractUnknownGroupTokens(entry));
      }
    }
    return tokens;
  }

  if (typeof value === 'object') {
    return extractUnknownGroupTokens(
      value.groupByte ?? value.groupId ?? value.group ?? value.id ?? value.value ?? value.byte
    );
  }

  return [];
}

function parseUnknownGroupToken(token) {
  const normalized = String(token).trim().toLowerCase();
  if (!normalized) {
    return null;
  }

  if (/^0x[0-9a-f]{1,2}$/.test(normalized)) {
    return Number.parseInt(normalized.slice(2), 16);
  }

  if (/^[0-9a-f]{2}$/.test(normalized)) {
    return Number.parseInt(normalized, 16);
  }

  return null;
}

function parseUnknownGroupIds(value, options = {}) {
  const maxGroups = options.maxGroups || UNKNOWN_GROUP_MAX_COUNT;
  const tokens = extractUnknownGroupTokens(value);
  const groups = [];
  const invalid = [];
  const duplicates = [];
  const skippedRegular = [];
  const seen = new Set();
  let truncated = false;

  for (const token of tokens) {
    const parsed = parseUnknownGroupToken(token);
    if (parsed === null || parsed < UNKNOWN_GROUP_MIN || parsed > UNKNOWN_GROUP_MAX) {
      invalid.push(String(token));
      continue;
    }

    if (seen.has(parsed)) {
      duplicates.push(parsed);
      continue;
    }

    seen.add(parsed);

    if (REGULAR_GROUP_BYTES.has(parsed)) {
      skippedRegular.push(parsed);
      continue;
    }

    if (groups.length >= maxGroups) {
      truncated = true;
      continue;
    }

    groups.push(parsed);
  }

  return { groups, invalid, duplicates, skippedRegular, truncated };
}

function formatUnknownGroupId(groupByte) {
  const numericValue = Number(groupByte);
  if (!Number.isFinite(numericValue)) {
    return '??';
  }
  return numericValue.toString(16).padStart(2, '0').toUpperCase();
}

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
  UNKNOWN_GROUP_MAX,
  UNKNOWN_GROUP_MAX_COUNT,
  UNKNOWN_GROUP_MIN,
  UNKNOWN_GROUP_MIN_INTERVAL,
  REGULAR_GROUP_BYTES,
  describePollingEntries,
  formatUnknownGroupId,
  normalizeBooleanValue,
  normalizePollingRequests,
  normalizeUnknownGroupPollingInterval,
  parseUnknownGroupIds,
};
