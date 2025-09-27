'use strict';

let sequenceCounter = 0;

function nextSequence() {
  sequenceCounter = (sequenceCounter + 1) & 0xff;
  if (sequenceCounter === 0) {
    sequenceCounter = 1;
  }
  return sequenceCounter;
}

function buildPayload(definition, params) {
  if (!definition) {
    return Buffer.alloc(0);
  }

  if (typeof definition.payload === 'function') {
    return Buffer.from(definition.payload(params) || []);
  }

  if (Array.isArray(definition.payload)) {
    return Buffer.from(definition.payload);
  }

  if (Buffer.isBuffer(definition.payload)) {
    return definition.payload;
  }

  if (typeof definition.payloadBuilder === 'function') {
    return Buffer.from(definition.payloadBuilder(params) || []);
  }

  return Buffer.alloc(0);
}

function calculateChecksum(buffer) {
  let sum = 0;
  for (const value of buffer.values()) {
    sum = (sum + value) & 0xff;
  }
  return sum & 0xff;
}

function encodeFrame(definition, params = {}) {
  const sequence = nextSequence();
  const command = definition.command;
  const payload = buildPayload(definition, params);
  const header = Buffer.from([0xaa, 0x55, sequence, command, payload.length]);
  const frameWithoutChecksum = Buffer.concat([header, payload]);
  const checksum = calculateChecksum(frameWithoutChecksum);
  const buffer = Buffer.concat([frameWithoutChecksum, Buffer.from([checksum])]);

  return {
    buffer,
    sequence,
  };
}

function decodeFrame(buffer) {
  if (!buffer || buffer.length === 0) {
    return null;
  }

  if (buffer[0] !== 0xaa) {
    return {
      frameLength: 1,
      error: 'Invalid frame header',
    };
  }

  if (buffer.length < 2) {
    return null;
  }

  if (buffer[1] !== 0x55) {
    const declaredLength = buffer[1];
    const frameLength = declaredLength + 1;

    if (buffer.length < frameLength) {
      return null;
    }

    const frame = buffer.slice(0, frameLength);
    const checksum = frame[frame.length - 1];
    let sum = 0;
    for (let i = 1; i < frame.length - 1; i++) {
      sum = (sum + frame[i]) & 0xff;
    }
    const expectedChecksum = (0x100 - sum) & 0xff;

    if (checksum !== expectedChecksum) {
      return {
        frameLength,
        error: 'Checksum mismatch',
        type: 'status',
      };
    }

    return {
      frameLength,
      command: frame[2],
      payload: frame.slice(3, frame.length - 1),
      payloadLength: frame.length - 4,
      sequence: null,
      type: 'status',
    };
  }

  if (buffer.length < 6) {
    return null;
  }

  const sequence = buffer[2];
  const command = buffer[3];
  const payloadLength = buffer[4];
  const frameLength = payloadLength + 6;

  if (buffer.length < frameLength) {
    return null;
  }

  const frame = buffer.slice(0, frameLength);
  const checksum = frame[frame.length - 1];
  const expectedChecksum = calculateChecksum(frame.slice(0, frame.length - 1));

  if (checksum !== expectedChecksum) {
    return {
      frameLength,
      error: 'Checksum mismatch',
    };
  }

  const payload = frame.slice(5, 5 + payloadLength);

  return {
    frameLength,
    sequence,
    command,
    payload,
    type: (command & 0x80) !== 0 ? 'response' : 'request',
    payloadLength,
  };
}

const STATUS_REQUEST = {
  command: 0x41,
  payloadBuilder: () => [0x01],
};

const REQUESTS = {
  power: {
    usesStatus: true,
    set: {
      command: 0x11,
      payloadBuilder: ({ value }) => [value ? 0x01 : 0x00],
    },
  },
  mode: {
    usesStatus: true,
    set: {
      command: 0x12,
      payloadBuilder: ({ value }) => [value & 0x0f],
    },
  },
  targetTemperature: {
    usesStatus: true,
    set: {
      command: 0x13,
      payloadBuilder: ({ value }) => [Math.round(value)],
    },
  },
  indoorTemperature: {
    usesStatus: true,
  },
  outdoorTemperature: {
    usesStatus: true,
  },
  fanSpeed: {
    usesStatus: true,
    set: {
      command: 0x16,
      payloadBuilder: ({ value }) => [value & 0x0f],
    },
  },
  swingMode: {
    usesStatus: true,
    set: {
      command: 0x17,
      payloadBuilder: ({ value }) => [value & 0x0f],
    },
  },
  ecoMode: {
    usesStatus: true,
    set: {
      command: 0x18,
      payloadBuilder: ({ value }) => [value ? 0x01 : 0x00],
    },
  },
  turboMode: {
    usesStatus: true,
    set: {
      command: 0x19,
      payloadBuilder: ({ value }) => [value ? 0x01 : 0x00],
    },
  },
  sleepMode: {
    usesStatus: true,
    set: {
      command: 0x1a,
      payloadBuilder: ({ value }) => [value ? 0x01 : 0x00],
    },
  },
};

module.exports = {
  encodeFrame,
  decodeFrame,
  REQUESTS,
  STATUS_REQUEST,
};
