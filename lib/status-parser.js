'use strict';

function decodeTemperature(byte, decimalNibble) {
  if (byte == null || byte === 0xff) {
    return null;
  }

  let value = (byte - 50) / 2;
  if (!Number.isFinite(value)) {
    return null;
  }

  if (decimalNibble != null && decimalNibble !== 0xf) {
    const decimal = decimalNibble / 10;
    if (value >= 0) {
      value += decimal;
    } else {
      value -= decimal;
    }
  }

  if (value < -50 || value > 100) {
    return null;
  }

  return Math.round(value * 10) / 10;
}

function mapFanSpeed(value) {
  if (value == null) {
    return null;
  }

  if (value === 0 || value === 101 || value === 102) {
    return 0; // auto / fixed
  }

  if (value <= 30) {
    return 1; // low / silent
  }

  if (value <= 60) {
    return 2; // medium
  }

  if (value <= 80) {
    return 3; // high
  }

  return 4; // turbo or higher
}

function parse0xACStatus(payload) {
  if (!payload || payload.length < 9) {
    return null;
  }

  const data = payload.slice(7, payload.length - 1);
  if (!data || data.length < 16) {
    return null;
  }

  const messageType = data[0];
  if (messageType !== 0xc0) {
    return null;
  }

  const values = {};

  const flags = data[1] ?? 0;
  values.power = (flags & 0x01) === 0x01;

  const modeAndTarget = data[2] ?? 0;
  values.mode = (modeAndTarget & 0xe0) >> 5;
  values.targetTemperature = 16 + (modeAndTarget & 0x0f) + ((modeAndTarget & 0x10) >> 4) * 0.5;

  const fanSpeedRaw = data[3] & 0x7f;
  const mappedFanSpeed = mapFanSpeed(fanSpeedRaw);
  if (mappedFanSpeed != null) {
    values.fanSpeed = mappedFanSpeed;
  }

  const swingByte = data[7] ?? 0;
  const updownFan = (swingByte & 0x0c) === 0x0c;
  const leftrightFan = (swingByte & 0x03) === 0x03;
  let swingMode = 0;
  if (updownFan && leftrightFan) {
    swingMode = 3;
  } else if (updownFan) {
    swingMode = 1;
  } else if (leftrightFan) {
    swingMode = 2;
  }
  values.swingMode = swingMode;

  const featureByte8 = data[8] ?? 0;
  const featureByte9 = data[9] ?? 0;
  const featureByte10 = data[10] ?? 0;
  const turbo2 = (featureByte8 & 0x20) === 0x20;
  values.ecoMode = (featureByte9 & 0x10) === 0x10;
  values.turboMode = (featureByte10 & 0x02) === 0x02 || turbo2;
  values.sleepMode = (featureByte10 & 0x01) === 0x01;

  const indoorTemperature = decodeTemperature(data[11], data[15] & 0x0f);
  if (indoorTemperature != null) {
    values.indoorTemperature = indoorTemperature;
  }

  const outdoorTemperature = decodeTemperature(data[12], (data[15] & 0xf0) >> 4);
  if (outdoorTemperature != null) {
    values.outdoorTemperature = outdoorTemperature;
  }

  return {
    command: 0xac,
    rawPayload: Buffer.from(payload),
    values,
  };
}

function parseStatusFrame(command, payload) {
  if (command === 0xac) {
    return parse0xACStatus(payload);
  }
  return null;
}

module.exports = {
  parseStatusFrame,
};
