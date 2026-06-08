'use strict';

const assert = require('assert');
const { normalizePollingRequests, parseUnknownGroupIds } = require('../lib/polling-config');

const DEFAULT_REQUESTS = [
  { id: 'getStatus', enabled: true, interval: 60 },
  { id: 'getCapabilities', enabled: false, interval: 3600 },
  { id: 'getPowerUsage', enabled: false, interval: 300 },
  { id: 'getGroup5Data', enabled: false, interval: 300 },
  { id: 'getGroup41Data', enabled: false, interval: 300 },
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
    { id: 'getGroup41Data', enabled: false, interval: 300 },
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
    { id: 'getGroup41Data', enabled: false, interval: 300 },
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
    { id: 'getGroup41Data', enabled: false, interval: 300 },
  ]
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getStatus', enabled: true, interval: 60 }],
  }).map((entry) => entry.id),
  ['getStatus', 'getCapabilities', 'getPowerUsage', 'getGroup5Data', 'getGroup41Data']
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
    pollingRequests: [{ id: 'getGroup41Data', enabled: true, interval: 60 }],
  }).find((entry) => entry.id === 'getGroup41Data'),
  { id: 'getGroup41Data', enabled: true, interval: 60 }
);

assert.deepStrictEqual(
  normalizePollingRequests({
    pollingRequests: [{ id: 'getPowerUsage', enabled: 'true', interval: 'not-a-number' }],
  }).find((entry) => entry.id === 'getPowerUsage'),
  { id: 'getPowerUsage', enabled: true, interval: 300 }
);

assert.deepStrictEqual(parseUnknownGroupIds('40,41,46').groups, [0x40, 0x41, 0x46]);
assert.deepStrictEqual(parseUnknownGroupIds('0x40,0x41').groups, [0x40, 0x41]);
assert.deepStrictEqual(parseUnknownGroupIds('29,30,40,50,60,zz,0x5f'), {
  groups: [0x30, 0x40, 0x50, 0x5f],
  invalid: ['29', '60', 'zz'],
  duplicates: [],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('40,0x40,41,41'), {
  groups: [0x40, 0x41],
  invalid: [],
  duplicates: [0x40, 0x41],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46'), {
  groups: [
    0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x40, 0x41, 0x42, 0x43, 0x44, 0x45,
  ],
  invalid: [],
  duplicates: [],
  truncated: true,
});

console.log('polling config normalization tests passed');
