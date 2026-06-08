'use strict';

const assert = require('assert');
const { normalizePollingRequests, parseUnknownGroupIds } = require('../lib/polling-config');

const DEFAULT_REQUESTS = [
  { id: 'getStatus', enabled: true, interval: 60 },
  { id: 'getCapabilities', enabled: false, interval: 3600 },
  { id: 'getPowerUsage', enabled: false, interval: 300 },
  { id: 'getGroup5Data', enabled: false, interval: 300 },
];

assert.deepStrictEqual(normalizePollingRequests({}), DEFAULT_REQUESTS);

assert.deepStrictEqual(
  normalizePollingRequests({
    polling: {
      requests: [
        { id: 'getStatus', enabled: true, interval: 30 },
        { id: 'getPowerUsage', enabled: true, interval: 45 },
      ],
    },
  }),
  [
    { id: 'getStatus', enabled: true, interval: 30 },
    { id: 'getCapabilities', enabled: false, interval: 3600 },
    { id: 'getPowerUsage', enabled: true, interval: 45 },
    { id: 'getGroup5Data', enabled: false, interval: 300 },
  ]
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [
      { id: 'getStatus', enabled: false, interval: 120 },
      { id: 'getCapabilities', enabled: true, interval: 600 },
    ],
  }),
  [
    { id: 'getStatus', enabled: false, interval: 120 },
    { id: 'getCapabilities', enabled: true, interval: 600 },
    { id: 'getPowerUsage', enabled: false, interval: 300 },
    { id: 'getGroup5Data', enabled: false, interval: 300 },
  ]
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [
      { id: 'getPowerUsage', enabled: true, interval: 30 },
      { id: 'getPowerUsage', enabled: false, interval: 999 },
    ],
  }).find((entry) => entry.id === 'getPowerUsage'),
  { id: 'getPowerUsage', enabled: true, interval: 30 }
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [
      { id: 'unknownMethod', enabled: true, interval: 10 },
      { id: 'getGroup5Data', enabled: true, interval: 60 },
    ],
  }),
  [
    { id: 'getStatus', enabled: true, interval: 60 },
    { id: 'getCapabilities', enabled: false, interval: 3600 },
    { id: 'getPowerUsage', enabled: false, interval: 300 },
    { id: 'getGroup5Data', enabled: true, interval: 60 },
  ]
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getStatus', enabled: true, interval: 60 }],
  }).map((entry) => entry.id),
  ['getStatus', 'getCapabilities', 'getPowerUsage', 'getGroup5Data']
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getPowerUsage', enabled: true, interval: 30 }],
  }).find((entry) => entry.id === 'getPowerUsage'),
  { id: 'getPowerUsage', enabled: true, interval: 30 }
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getGroup5Data', enabled: false, interval: 30 }],
  }).find((entry) => entry.id === 'getGroup5Data'),
  { id: 'getGroup5Data', enabled: false, interval: 30 }
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getPowerUsage', enabled: 'true', interval: 'not-a-number' }],
  }).find((entry) => entry.id === 'getPowerUsage'),
  { id: 'getPowerUsage', enabled: true, interval: 300 }
);

assert.deepStrictEqual(parseUnknownGroupIds('40,41,46').groups, [0x40, 0x41, 0x46]);
assert.deepStrictEqual(parseUnknownGroupIds('0x40,0x41').groups, [0x40, 0x41]);
assert.deepStrictEqual(parseUnknownGroupIds('39,40,50,zz,0x4f'), {
  groups: [0x40, 0x4f],
  invalid: ['39', '50', 'zz'],
  duplicates: [],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('40,0x40,41,41'), {
  groups: [0x40, 0x41],
  invalid: [],
  duplicates: [0x40, 0x41],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('40,41,42,43,44,45,46,47,48,49'), {
  groups: [0x40, 0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47],
  invalid: [],
  duplicates: [],
  truncated: true,
});

console.log('polling config normalization tests passed');
