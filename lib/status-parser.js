'use strict';

function decodeTemperature(byte) {
  if (byte == null || byte === 0xff) {
    return null;
  }

  const value = (byte - 80) / 2;
  if (!Number.isFinite(value)) {
    return null;
  }

  if (value < -40 || value > 80) {
    return null;
  }

  return Math.round(value * 2) / 2;
}

function pickOutdoorTemperature(bytes) {
  for (const byte of bytes) {
    const temperature = decodeTemperature(byte);
    if (temperature != null) {
      return temperature;
    }
  }
  return null;
}

function parse0xACStatus(payload) {
  if (!payload || payload.length < 16) {
    return null;
  }

  const values = {};

  const flags = payload[5] ?? 0;
  values.power = (flags & 0x01) === 0x01;
  values.mode = (flags >> 1) & 0x07;

  const targetRaw = payload[6] & 0x1f;
  values.targetTemperature = 8 + targetRaw;

  values.fanSpeed = payload[7] & 0x0f;
  values.swingMode = payload[8] & 0x0f;

  const indoorTemperature = decodeTemperature(payload[10]);
  if (indoorTemperature != null) {
    values.indoorTemperature = indoorTemperature;
  }

  const outdoorTemperature = pickOutdoorTemperature([payload[11], payload[12], payload[13]]);
  if (outdoorTemperature != null) {
    values.outdoorTemperature = outdoorTemperature;
  }

  const featureFlags = payload[15] ?? 0;
  values.ecoMode = (featureFlags & 0x02) === 0x02;
  values.turboMode = (featureFlags & 0x04) === 0x04;
  values.sleepMode = (featureFlags & 0x08) === 0x08;

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
