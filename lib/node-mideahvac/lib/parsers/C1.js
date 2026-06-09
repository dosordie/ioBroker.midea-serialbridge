'use strict';

const logger = require('winston');
const { addRawHexDebug, bcdByteToNumber } = require('./raw');

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
  // the current power usage.
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

function decodeMideaTemperature(value) {
  return (value - 50) / 2;
}

function decodeGroup41IndoorTemperature(value) {
  return value - 50;
}

function parseGroup43(data) {
  if (data.length <= 10) {
    logger.debug(
      `C1.parser: Group 43 payload too short (${data.length}); expected at least 11 bytes`
    );
    return {};
  }

  const status = {
    outdoorFanCommandCandidate: data[10],
  };

  logger.debug(
    `C1.parser: Decoded group 43 diagnostic data: outdoorFanCommandCandidate=${status.outdoorFanCommandCandidate}`
  );

  return status;
}

function parseGroup41(data) {
  if (data.length < 14) {
    logger.debug(
      `C1.parser: Group 41 payload too short (${data.length}); expected at least 14 bytes`
    );
    return {};
  }

  const status = {
    compressorFrequency: data[4],
    group41Byte08Raw: data[8],
    group41Byte08TemperatureCandidate: decodeMideaTemperature(data[8]),
    indoorPipeTemperature: decodeGroup41IndoorTemperature(data[10]),
    indoorHeatExchangerTemperature: decodeGroup41IndoorTemperature(data[11]),
    outdoorHeatExchangerTemperatureCandidate: decodeMideaTemperature(data[12]),
    outdoorTemperatureGroup41: decodeMideaTemperature(data[13]),
  };

  logger.debug(
    `C1.parser: Decoded group 41 diagnostic data: compressorFrequency=${status.compressorFrequency}, group41Byte08Raw=${status.group41Byte08Raw}, group41Byte08TemperatureCandidate=${status.group41Byte08TemperatureCandidate}, indoorPipeTemperature=${status.indoorPipeTemperature}, indoorHeatExchangerTemperature=${status.indoorHeatExchangerTemperature}, outdoorHeatExchangerTemperatureCandidate=${status.outdoorHeatExchangerTemperatureCandidate}, outdoorTemperatureGroup41=${status.outdoorTemperatureGroup41}`
  );

  return status;
}

exports.parser = (data, options = {}) => {
  logger.debug(`C1.parser: Entering with ${data.toString('hex')}`);

  if (data.length < 4) {
    logger.error(`C1.parser: Invalid length of message (${data.length})`);
    return addRawHexDebug({}, data, options);
  }

  const groupByte = data[3];
  const group = groupByte & 0x0f;
  let status;

  switch (groupByte) {
    case 0x41:
      status = parseGroup41(data);
      break;
    case 0x43:
      status = parseGroup43(data);
      break;
    case 0x44:
      status = parsePowerUsage(data);
      break;
    case 0x45:
      status = parseGroup5(data);
      break;
    default:
      logger.debug(`C1.parser: Unsupported group data response (0x${groupByte.toString(16)})`);
      status = {};
      break;
  }

  status.group = group;

  if (groupByte === 0x41) {
    status.group41_rawFrameHex = options.frame ? options.frame.toString('hex') : '';
    status.group41_payloadHex = data.toString('hex');
  }

  if (groupByte === 0x43) {
    status.group43_rawFrameHex = options.frame ? options.frame.toString('hex') : '';
    status.group43_payloadHex = data.toString('hex');
  }

  return addRawHexDebug(status, data, options);
};
