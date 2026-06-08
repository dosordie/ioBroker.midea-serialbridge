'use strict';

function toSigned8(value) {
  return value & 0x80 ? value - 0x100 : value;
}

function toSigned16(value) {
  return value & 0x8000 ? value - 0x10000 : value;
}

function bcdByteToNumber(value) {
  const high = (value >> 4) & 0x0F;
  const low = value & 0x0F;

  if (high > 9 || low > 9) {
    return null;
  }

  return high * 10 + low;
}

function hexByte(value) {
  return value.toString(16).padStart(2, '0');
}

function byteKey(offset) {
  return offset.toString().padStart(2, '0');
}

function addRawBytes(status, payload, frame) {
  status.rawFrameHex = frame ? frame.toString('hex') : '';
  status.payloadHex = payload.toString('hex');

  const rawBytes = {};
  for (let i = 0; i < payload.length; i++) {
    const key = byteKey(i);
    const value = payload[i];
    const bits = value.toString(2).padStart(8, '0');

    status[`rawByte${key}`] = value;
    status[`rawByte${key}Bits`] = bits;
    rawBytes[key] = {
      hex: hexByte(value),
      u8: value,
      s8: toSigned8(value),
      bits,
    };
  }

  status.rawBytes = rawBytes;
}

function buildAnalogCandidates(payload) {
  const candidates = {};

  for (let i = 0; i < payload.length; i++) {
    const key = byteKey(i);
    const value = payload[i];
    candidates[`byte${key}`] = {
      u8: value,
      s8: toSigned8(value),
      bcd: bcdByteToNumber(value),
    };

    if (i < payload.length - 1) {
      const next = payload[i + 1];
      const u16le = value | (next << 8);
      const u16be = (value << 8) | next;
      candidates[`byte${key}_${byteKey(i + 1)}`] = {
        u16le,
        u16be,
        s16le: toSigned16(u16le),
        s16be: toSigned16(u16be),
        bcd: bcdByteToNumber(value) !== null && bcdByteToNumber(next) !== null
          ? bcdByteToNumber(value) * 100 + bcdByteToNumber(next)
          : null,
      };
    }
  }

  return candidates;
}

function addAnalogCandidates(status, payload) {
  // These values are deliberately analysis-only: they expose alternative
  // interpretations of each byte/word so logs can be compared while sensors,
  // pressures, currents, frequencies or valve positions are changed manually.
  // They must not be used as normal control/status datapoints until the Midea
  // protocol meaning is verified.
  status.analogCandidates = buildAnalogCandidates(payload);
}

function addParserDebug(status, payload, options = {}) {
  if (options.exposeRawBytes) {
    addRawBytes(status, payload, options.frame);
  }

  if (options.exposeAnalogCandidates) {
    addAnalogCandidates(status, payload);
  }

  return status;
}

module.exports = {
  addParserDebug,
  buildAnalogCandidates,
  bcdByteToNumber,
  toSigned8,
  toSigned16,
};
