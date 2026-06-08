'use strict';

const assert = require('assert');
const {
  bcdByteToNumber,
  buildAnalogCandidates,
  toSigned8,
  toSigned16,
} = require('../lib/node-mideahvac/lib/parsers/raw');

assert.strictEqual(toSigned8(0x7f), 127);
assert.strictEqual(toSigned8(0x80), -128);
assert.strictEqual(toSigned8(0xff), -1);

assert.strictEqual(toSigned16(0x7fff), 32767);
assert.strictEqual(toSigned16(0x8000), -32768);
assert.strictEqual(toSigned16(0xffff), -1);

assert.strictEqual(bcdByteToNumber(0x42), 42);
assert.strictEqual(bcdByteToNumber(0x99), 99);
assert.strictEqual(bcdByteToNumber(0xfa), null);

const candidates = buildAnalogCandidates(Buffer.from([0x12, 0x34, 0x80]));
assert.deepStrictEqual(candidates.byte00, { u8: 0x12, s8: 0x12, bcd: 12 });
assert.deepStrictEqual(candidates.byte00_01, {
  u16le: 0x3412,
  u16be: 0x1234,
  s16le: 0x3412,
  s16be: 0x1234,
  bcd: 1234,
});
assert.deepStrictEqual(candidates.byte01_02, {
  u16le: 0x8034,
  u16be: 0x3480,
  s16le: -32716,
  s16be: 0x3480,
  bcd: 3480,
});

console.log('raw parser helper tests passed');
