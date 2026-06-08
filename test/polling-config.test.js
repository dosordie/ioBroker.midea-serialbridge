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

assert.deepStrictEqual(parseUnknownGroupIds('40,41,46'), {
  groups: [0x40, 0x46],
  invalid: [],
  duplicates: [],
  skippedRegular: [0x41],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('0x40,0x41'), {
  groups: [0x40],
  invalid: [],
  duplicates: [],
  skippedRegular: [0x41],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('20,21,30,31,41,44,45,50,51,60,7F,80,xx'), {
  groups: [0x20, 0x21, 0x30, 0x31, 0x50, 0x51, 0x60, 0x7f],
  invalid: ['80', 'xx'],
  duplicates: [],
  skippedRegular: [0x41, 0x44, 0x45],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('40,0x40,41,41'), {
  groups: [0x40],
  invalid: [],
  duplicates: [0x40, 0x41],
  skippedRegular: [0x41],
  truncated: false,
});
assert.deepStrictEqual(parseUnknownGroupIds('20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36'), {
  groups: [
    0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35,
  ],
  invalid: [],
  duplicates: [],
  skippedRegular: [],
  truncated: true,
});

console.log('polling config normalization tests passed');
