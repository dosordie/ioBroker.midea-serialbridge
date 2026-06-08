'use strict';

const logger = require('winston');
const { addParserDebug, bcdByteToNumber } = require('./raw');

// Add a transport as fall back when no parent logger has been initialized
// to prevent the error: "Attempt to write logs with no transports"
logger.add(
  new logger.transports.Console({
    level: 'none',
  })
);

function decodeBcdNumber(data, start, length) {
  if (data.length < start + length) {
    return null;
  }

  let value = 0;
  for (let i = 0; i < length; i++) {
    const decodedByte = bcdByteToNumber(data[start + i]);
    if (decodedByte === null) {
      return null;
    }

    value = value * 100 + decodedByte;
  }

  return value;
}

function parsePowerUsage(data) {
  if (data.length < 19) {
    logger.error(`C1.parser: Invalid length of group 4 message (${data.length})`);
    return {};
  }

  const status = {};

  // Bytes 4-7 contain the BCD representation of the internal total energy
  // counter in kWh with two decimal places.
  const totalEnergy = decodeBcdNumber(data, 4, 4);
  if (totalEnergy === null) {
    logger.debug('C1.parser: Could not decode group 4 totalEnergy from bytes 4-7');
  } else {
    status.totalEnergy = totalEnergy / 100;
    logger.debug(`C1.parser: Decoded group 4 totalEnergy: ${status.totalEnergy} kWh`);
  }

  // Byte 16, 17, and 18 contain the binary coded decimal representation of
  // the current power usage. This is a confirmed analog-like energy value;
  // remaining C1 bytes are exposed via raw/analog debug options for analysis.
  const powerUsage = decodeBcdNumber(data, 16, 3);
  if (powerUsage === null) {
    logger.debug('C1.parser: Could not decode group 4 powerUsage from bytes 16-18');
  } else {
    status.powerUsage = powerUsage / 10000;
  }

  return status;
}

function parseGroup5(data) {
  const status = {};

  if (data.length > 4) {
    const humidity = data[4];
    status.humidity = humidity === 0 ? null : humidity;
    status.indoorHumidity = humidity === 0 ? null : humidity;
  }

  if (data.length > 8) {
    status.outdoorFanSpeed = data[8] * 8;
  }

  if (data.length > 10) {
    status.defrost = Boolean(data[10]);
    status.defrostActive = Boolean(data[10]);
  }

  return status;
}

exports.parser = (data, options = {}) => {
  logger.debug(`C1.parser: Entering with ${data.toString('hex')}`);

  if (data.length < 4) {
    logger.error(`C1.parser: Invalid length of message (${data.length})`);
    return addParserDebug({}, data, options);
  }

  const group = data[3] & 0x0f;
  let status;

  switch (group) {
    case 4:
      status = parsePowerUsage(data);
      break;
    case 5:
      status = parseGroup5(data);
      break;
    default:
      logger.debug(`C1.parser: Unsupported group data response (${group})`);
      status = {};
      break;
  }

  status.group = group;

  return addParserDebug(status, data, {
    ...options,
    exposeRawBytes: options.exposeRawBytes || group === 5,
  });
};
