'use strict';

function bcdByteToNumber(value) {
  const high = (value >> 4) & 0x0f;
  const low = value & 0x0f;

  if (high > 9 || low > 9) {
    return null;
  }

  return high * 10 + low;
}

function addRawHexDebug(status, payload, options = {}) {
  status.rawFrameHex = options.frame ? options.frame.toString('hex') : '';
  status.payloadHex = payload.toString('hex');
  return status;
}

module.exports = {
  addRawHexDebug,
  bcdByteToNumber,
};
