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

const group41FanOnly = parser(Buffer.from('c12101410000000094054949656b000000000000', 'hex'));
assert.strictEqual(group41FanOnly.compressorFrequency, 0);
assert.strictEqual(group41FanOnly.group41Byte08Raw, 148);
assert.strictEqual(group41FanOnly.group41Byte08TemperatureCandidate, 49.0);
assert.strictEqual(group41FanOnly.indoorPipeTemperature, 23);
assert.strictEqual(group41FanOnly.indoorHeatExchangerTemperature, 23);
assert.strictEqual(group41FanOnly.outdoorHeatExchangerTemperatureCandidate, 25.5);
assert.strictEqual(group41FanOnly.outdoorTemperatureGroup41, 28.5);
assert.strictEqual(group41FanOnly.group41_payloadHex, 'c12101410000000094054949656b000000000000');
assert.strictEqual(group41FanOnly.rawBytes, undefined);
assert.strictEqual(group41FanOnly.analogCandidates, undefined);
assert.strictEqual(group41FanOnly.outdoorPipeTemperatureCandidate, undefined);
assert.strictEqual(group41FanOnly.hotGasOrCondenserTemperatureCandidate, undefined);
assert.strictEqual(group41FanOnly.outdoorCoilTemperatureCandidate, undefined);

const group41Cooling = parser(Buffer.from('c1210141390000009d004641716d000000000000', 'hex'));
assert.strictEqual(group41Cooling.compressorFrequency, 57);
assert.strictEqual(group41Cooling.group41Byte08Raw, 157);
assert.strictEqual(group41Cooling.group41Byte08TemperatureCandidate, 53.5);
assert.strictEqual(group41Cooling.indoorPipeTemperature, 20);
assert.strictEqual(group41Cooling.indoorHeatExchangerTemperature, 15);
assert.strictEqual(group41Cooling.outdoorHeatExchangerTemperatureCandidate, 31.5);
assert.strictEqual(group41Cooling.outdoorTemperatureGroup41, 29.5);

const group41Heating = parser(Buffer.from('c12101411b0000009d005a66706b000000000000', 'hex'));
assert.strictEqual(group41Heating.compressorFrequency, 27);
assert.strictEqual(group41Heating.group41Byte08Raw, 157);
assert.strictEqual(group41Heating.group41Byte08TemperatureCandidate, 53.5);
assert.strictEqual(group41Heating.indoorPipeTemperature, 40);
assert.strictEqual(group41Heating.indoorHeatExchangerTemperature, 52);
assert.strictEqual(group41Heating.outdoorHeatExchangerTemperatureCandidate, 31);
assert.strictEqual(group41Heating.outdoorTemperatureGroup41, 28.5);

for (const value of [87, 97, 0]) {
  const group43 = Buffer.from('c121014300000000000000000000000000000000', 'hex');
  group43[10] = value;
  const parsedGroup43 = parser(group43, { frame: Buffer.from([0xaa, 0x43]) });
  assert.strictEqual(parsedGroup43.outdoorFanCommandCandidate, value);
  assert.strictEqual(parsedGroup43.group, 3);
  assert.strictEqual(parsedGroup43.group43_rawFrameHex, 'aa43');
  assert.strictEqual(parsedGroup43.group43_payloadHex, group43.toString('hex'));
  assert.strictEqual(parsedGroup43.rawFrameHex, 'aa43');
  assert.strictEqual(parsedGroup43.payloadHex, group43.toString('hex'));
  assert.strictEqual(parsedGroup43.rawBytes, undefined);
  assert.strictEqual(parsedGroup43.rawByte10, undefined);
  assert.strictEqual(parsedGroup43.rawByte10Bits, undefined);
  assert.strictEqual(parsedGroup43.analogCandidates, undefined);
}

const shortGroup41 = parser(Buffer.from([0xc1, 0x21, 0x01, 0x41, 0x21]));
assert.strictEqual(shortGroup41.compressorFrequency, undefined);
assert.strictEqual(shortGroup41.group, 1);

const debug = parser(group5, { frame: Buffer.from([0xaa, 0xbb]) });
assert.strictEqual(debug.rawFrameHex, 'aabb');
assert.strictEqual(debug.payloadHex, group5.toString('hex'));
assert.strictEqual(debug.rawBytes, undefined);
assert.strictEqual(debug.rawByte04, undefined);
assert.strictEqual(debug.rawByte04Bits, undefined);
assert.strictEqual(debug.analogCandidates, undefined);

console.log('C1 parser tests passed');
