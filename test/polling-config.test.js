'use strict';

const assert = require('assert');
const { normalizePollingRequests } = require('../lib/polling-config');

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

console.log('polling config normalization tests passed');
