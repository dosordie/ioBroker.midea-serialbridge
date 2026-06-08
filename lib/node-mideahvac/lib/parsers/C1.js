'use strict';

const logger = require('winston');
const { addParserDebug } = require('./raw');

// Add a transport as fall back when no parent logger has been initialized
// to prevent the error: "Attempt to write logs with no transports"
logger.add(
  new logger.transports.Console({
    level: 'none',
  })
);

function parsePowerUsage(data) {
  if (data.length < 19) {
    logger.error(`C1.parser: Invalid length of group 4 message (${data.length})`);
    return {};
  }

  // Byte 16, 17, and 18 contain the binary coded decimal representation of
  // the current power usage. This is a confirmed analog-like energy value;
  // remaining C1 bytes are exposed via raw/analog debug options for analysis.
  let n = 0;
  let m = 1;
  for (let i = 0; i < 3; i++) {
    n += (data[18 - i] & 0x0f) * m;
    n += ((data[18 - i] >> 4) & 0x0f) * m * 10;
    m *= 100;
  }

  return { powerUsage: n / 10000 };
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
