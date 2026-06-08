'use strict';

const assert = require('assert');
const { parser } = require('../lib/node-mideahvac/lib/parsers/C1');

const group4 = Buffer.alloc(20, 0x00);
group4[0] = 0xc1;
group4[3] = 0x44;
group4[16] = 0x01;
group4[17] = 0x23;
group4[18] = 0x45;
const group4Status = parser(group4);
assert.strictEqual(group4Status.totalEnergy, 0);
assert.strictEqual(group4Status.powerUsage, 1.2345);
assert.strictEqual(group4Status.group, 4);
assert.strictEqual(group4Status.rawFrameHex, '');
assert.strictEqual(group4Status.payloadHex, group4.toString('hex'));

const group4TotalEnergy = Buffer.from('c121014400193025000000000000000000000000', 'hex');
assert.strictEqual(parser(group4TotalEnergy).totalEnergy, 1930.25);

const group4EarlierTotalEnergy = Buffer.from('c121014400193014000000000000000000000000', 'hex');
assert.strictEqual(parser(group4EarlierTotalEnergy).totalEnergy, 1930.14);

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

const group41Off = parser(Buffer.from('c12101410000000094004440676d000000000000', 'hex'));
assert.strictEqual(group41Off.compressorFrequencyCandidate, 0);
assert.strictEqual(group41Off.hotGasOrCondenserTemperatureCandidate, 49.0);
assert.strictEqual(group41Off.evaporatorTemperature1Candidate, 9.0);
assert.strictEqual(group41Off.evaporatorTemperature2Candidate, 7.0);
assert.strictEqual(group41Off.outdoorCoilTemperatureCandidate, 26.5);
assert.strictEqual(group41Off.outdoorAmbientTemperatureCandidate, 29.5);
assert.strictEqual(group41Off.group41_payloadHex, 'c12101410000000094004440676d000000000000');
assert.strictEqual(group41Off.rawBytes, undefined);
assert.strictEqual(group41Off.analogCandidates, undefined);

const group41Running = parser(Buffer.from('c1210141002100009940443f6f6c000000000000', 'hex'));
assert.strictEqual(group41Running.compressorFrequencyCandidate, 33);
assert.strictEqual(group41Running.hotGasOrCondenserTemperatureCandidate, 50.5);
assert.strictEqual(group41Running.evaporatorTemperature1Candidate, 9.0);
assert.strictEqual(group41Running.evaporatorTemperature2Candidate, 6.5);
assert.strictEqual(group41Running.outdoorCoilTemperatureCandidate, 30.5);
assert.strictEqual(group41Running.outdoorAmbientTemperatureCandidate, 29.0);

const shortGroup41 = parser(Buffer.from([0xc1, 0x21, 0x01, 0x41, 0x21]));
assert.strictEqual(shortGroup41.compressorFrequencyCandidate, undefined);
assert.strictEqual(shortGroup41.group, 1);

const debug = parser(group5, { frame: Buffer.from([0xaa, 0xbb]) });
assert.strictEqual(debug.rawFrameHex, 'aabb');
assert.strictEqual(debug.payloadHex, group5.toString('hex'));
assert.strictEqual(debug.rawBytes, undefined);
assert.strictEqual(debug.rawByte04, undefined);
assert.strictEqual(debug.rawByte04Bits, undefined);
assert.strictEqual(debug.analogCandidates, undefined);

console.log('C1 parser tests passed');
