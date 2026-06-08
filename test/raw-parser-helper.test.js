'use strict';

const assert = require('assert');
const { addRawHexDebug, bcdByteToNumber } = require('../lib/node-mideahvac/lib/parsers/raw');

assert.strictEqual(bcdByteToNumber(0x42), 42);
assert.strictEqual(bcdByteToNumber(0x99), 99);
assert.strictEqual(bcdByteToNumber(0xfa), null);

const payload = Buffer.from([0xc1, 0x21, 0x01, 0x45, 0x37]);
const frame = Buffer.from([0xaa, 0xbb]);
const debug = addRawHexDebug({}, payload, { frame });

assert.deepStrictEqual(debug, {
  rawFrameHex: 'aabb',
  payloadHex: 'c121014537',
});
assert.strictEqual(debug.rawBytes, undefined);
assert.strictEqual(debug.rawByte04, undefined);
assert.strictEqual(debug.rawByte04Bits, undefined);
assert.strictEqual(debug.analogCandidates, undefined);

console.log('raw parser helper tests passed');
