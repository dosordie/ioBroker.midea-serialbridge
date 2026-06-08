'use strict';

const logger = require('winston');
const B5 = require('./B5.js');
const C0 = require('./C0');
const C1 = require('./C1');

// Add a transport as fall back when no parent logger has been initialized
// to prevent the error: "Attempt to write logs with no transports"
logger.add(new logger.transports.Console({
  level: 'none'
}));

exports.parse = (data, options = {}) => {
  const frame = data;
  data = data.subarray(10, data.length - 2);
  const parserOptions = {
    ...options,
    frame,
  };

  switch (data[0]) {
    case 0xB5:
      return B5.parser(data, parserOptions);

    case 0xC0:
      return C0.parser(data, parserOptions);

    case 0xC1:
      return C1.parser(data, parserOptions);

    default:
      logger.error(`Parsers: Unsupported response type: ${data[0].toString(16)}`);
      return {};
  }
};
