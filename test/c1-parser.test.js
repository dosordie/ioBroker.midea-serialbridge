'use strict';

const assert = require('assert');
const { parser } = require('../lib/node-mideahvac/lib/parsers/C1');

const group4 = Buffer.alloc(20, 0x00);
group4[0] = 0xc1;
group4[3] = 0x44;
group4[16] = 0x01;
group4[17] = 0x23;
group4[18] = 0x45;
assert.deepStrictEqual(parser(group4), { powerUsage: 1.2345, group: 4 });

const group5 = Buffer.alloc(20, 0x00);
group5[0] = 0xc1;
group5[3] = 0x45;
group5[4] = 55;
group5[8] = 12;
group5[10] = 1;
assert.deepStrictEqual(
  {
    humidity: parser(group5).humidity,
    indoorHumidity: parser(group5).indoorHumidity,
    outdoorFanSpeed: parser(group5).outdoorFanSpeed,
    defrost: parser(group5).defrost,
    defrostActive: parser(group5).defrostActive,
    group: parser(group5).group,
  },
  {
    humidity: 55,
    indoorHumidity: 55,
    outdoorFanSpeed: 96,
    defrost: true,
    defrostActive: true,
    group: 5,
  }
);

const group5ZeroHumidity = Buffer.from(group5);
group5ZeroHumidity[4] = 0;
assert.strictEqual(parser(group5ZeroHumidity).humidity, null);
assert.strictEqual(parser(group5ZeroHumidity).indoorHumidity, null);

const shortGroup5 = Buffer.from([0xc1, 0x00, 0x00, 0x45, 44]);
assert.strictEqual(parser(shortGroup5).humidity, 44);
assert.strictEqual(parser(shortGroup5).indoorHumidity, 44);
assert.strictEqual(parser(shortGroup5).group, 5);

const debug = parser(group5, { exposeRawBytes: true, frame: Buffer.from([0xaa, 0xbb]) });
assert.strictEqual(debug.rawFrameHex, 'aabb');
assert.strictEqual(debug.payloadHex, group5.toString('hex'));
assert.strictEqual(debug.rawBytes['04'].u8, 55);

console.log('C1 parser tests passed');
