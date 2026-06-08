'use strict';

const logger = require('winston');
const { addParserDebug } = require('./raw');

// Add a transport as fall back when no parent logger has been initialized
// to prevent the error: "Attempt to write logs with no transports"
logger.add(new logger.transports.Console({
  level: 'none'
}));

exports.parser = (data, options = {}) => {
  logger.debug(`C1.parser: Entering with ${data.toString('hex')}`);

  if (data.length < 19) {
    logger.error(`C1.parser: Invalid length of message (${data.length})`);
    return {};
  }

  // Byte 16, 17, and 18 contain the binary coded decimal representation of
  // the current power usage. This is a confirmed analog-like energy value;
  // remaining C1 bytes are exposed via raw/analog debug options for analysis.
  let n = 0;
  let m = 1;
  for (let i = 0; i < 3; i++) {
    n += (data[18 - i] & 0x0F) * m;
    n += ((data[18 - i] >> 4) & 0x0F) * m * 10;
    m *= 100;
  }

  return addParserDebug({ powerUsage: n / 10000 }, data, options);
};
