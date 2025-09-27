'use strict';

const net = require('net');
const EventEmitter = require('events');
const { encodeFrame, decodeFrame, REQUESTS } = require('./protocol');
const { parseStatusFrame } = require('./status-parser');

function formatBuffer(buffer, maxLength = 256) {
  if (!buffer || buffer.length === 0) {
    return '<empty>';
  }

  const length = Math.min(buffer.length, maxLength);
  const hex = buffer.slice(0, length).toString('hex');
  const bytes = hex.match(/.{1,2}/g) || [];
  const spaced = bytes.join(' ');
  if (length < buffer.length) {
    return `${spaced} …(${buffer.length} bytes total)`;
  }
  return spaced;
}

class MideaSerialBridge extends EventEmitter {
  constructor(options) {
    super();
    this.host = options.host;
    this.port = options.port;
    this.reconnectInterval = options.reconnectInterval || 10000;
    this.log = options.log;

    this.socket = null;
    this.connected = false;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.reconnectTimer = null;
    this._sendChain = Promise.resolve();
    this.statusVersion = 0;
    this.statusValues = new Map();
    this.statusWaiters = new Map();
  }

  connect() {
    if (this.connected || this.socket) {
      return;
    }

    this.log.debug(`Connecting to serial bridge ${this.host}:${this.port}`);

    this.socket = new net.Socket();
    this.socket.setNoDelay(true);

    this.socket.on('connect', () => {
      this.log.info(`Connected to ${this.host}:${this.port}`);
      this.connected = true;
      this.emit('connected');
    });

    this.socket.on('error', (error) => {
      this.log.error(`Serial bridge error: ${error.message}`);
      this._rejectAllPending(new Error(`Serial bridge error: ${error.message}`));
      this._scheduleReconnect();
      this.emit('error', error);
    });

    this.socket.on('close', () => {
      this.log.warn('Serial bridge connection closed');
      this.connected = false;
      this.socket = null;
      this.emit('disconnected');
      this._rejectAllPending(new Error('Serial bridge connection closed'));
      this._sendChain = Promise.resolve();
      this._scheduleReconnect();
    });

    this.socket.on('data', (data) => this._handleData(data));

    this.socket.connect(this.port, this.host);
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }

    this.connected = false;
    this._rejectAllPending(new Error('Disconnected from serial bridge'));
    this._sendChain = Promise.resolve();
  }

  _rejectAllPending(error) {
    if (!error) {
      error = new Error('Request aborted');
    }

    for (const [sequence, pending] of this.pending.entries()) {
      const { reject, timeout, metadata } = pending;
      clearTimeout(timeout);
      if (metadata) {
        const context = metadata.datapointId
          ? `${metadata.operation || 'request'} ${metadata.datapointId}`
          : `sequence ${sequence}`;
        this.log.debug(`Rejecting pending ${context} due to connection issue: ${error.message}`);
      }
      try {
        reject(error);
      } catch (rejectError) {
        this.log.debug(`Failed to reject pending request ${sequence}: ${rejectError.message}`);
      }
    }
    this.pending.clear();
    this._rejectAllStatusWaiters(error);
  }

  _scheduleReconnect() {
    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, this.reconnectInterval);
  }

  _handleData(chunk) {
    this.log.debug(
      `Received data chunk (${chunk.length} bytes) from bridge: ${formatBuffer(chunk)}`
    );

    this.buffer = Buffer.concat([this.buffer, chunk]);

    let frame;
    do {
      frame = decodeFrame(this.buffer);
      if (frame && frame.frameLength > 0 && this.buffer.length >= frame.frameLength) {
        const rawFrame = this.buffer.slice(0, frame.frameLength);
        this.buffer = this.buffer.slice(frame.frameLength);
        this._handleFrame(frame, rawFrame);
      } else {
        frame = null;
      }
    } while (frame);
  }

  _handleFrame(frame, rawFrame) {
    if (frame.error) {
      if (frame.type === 'status') {
        this.log.debug(`Ignoring status frame with invalid checksum`);
        return;
      }
      this.log.warn(`Received invalid frame: ${frame.error}`);
      return;
    }

    if (frame.type === 'status') {
      this.log.debug(
        `Received status frame (command 0x${frame.command
          .toString(16)
          .padStart(2, '0')}) with payload (${frame.payloadLength} bytes): ${formatBuffer(
          frame.payload
        )}`
      );

      const status = parseStatusFrame(frame.command, frame.payload);
      if (status && status.values && Object.keys(status.values).length > 0) {
        this._handleStatusValues(status.values);
        this.emit('statusData', status, rawFrame);
      }

      this.emit('status', frame, rawFrame);
      return;
    }

    const key = frame.sequence != null ? frame.sequence : null;

    const commandHex = `0x${frame.command.toString(16).padStart(2, '0')}`;
    this.log.debug(
      `Decoded frame sequence ${frame.sequence} (${frame.type}, command ${commandHex}) with payload (${frame.payloadLength} bytes): ${formatBuffer(frame.payload)}`
    );

    if (key && this.pending.has(key)) {
      const { resolve, reject, timeout, metadata } = this.pending.get(key);
      clearTimeout(timeout);
      this.pending.delete(key);

      if (frame.type === 'error') {
        if (metadata) {
          this.log.debug(
            `Bridge responded with error for ${metadata.operation || 'request'} ${
              metadata.datapointId || 'unknown'
            } (sequence ${key})`
          );
        }
        reject(new Error(frame.message || 'Bridge returned an error'));
        return;
      }

      if (metadata) {
        this.log.debug(
          `Received response for ${metadata.operation || 'request'} ${
            metadata.datapointId || 'unknown'
          } (sequence ${key})`
        );
      }
      resolve(frame.payload);
      return;
    }

    this.log.debug(
      `Received unsolicited frame (sequence ${frame.sequence}). Raw: ${formatBuffer(rawFrame)}`
    );
    this.emit('frame', frame, rawFrame);
  }

  _handleStatusValues(values) {
    if (!values || typeof values !== 'object') {
      return;
    }

    const entries = Object.entries(values).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
      return;
    }

    this.statusVersion += 1;
    const version = this.statusVersion;

    for (const [datapointId, value] of entries) {
      this.statusValues.set(datapointId, { value, version });
      this._notifyStatusWaiters(datapointId, value, version);
    }
  }

  _addStatusWaiter(datapointId, waiter) {
    if (!this.statusWaiters.has(datapointId)) {
      this.statusWaiters.set(datapointId, new Set());
    }
    this.statusWaiters.get(datapointId).add(waiter);
  }

  _removeStatusWaiter(datapointId, waiter) {
    if (!this.statusWaiters.has(datapointId)) {
      return;
    }
    const waiters = this.statusWaiters.get(datapointId);
    waiters.delete(waiter);
    if (waiters.size === 0) {
      this.statusWaiters.delete(datapointId);
    }
  }

  _notifyStatusWaiters(datapointId, value, version) {
    if (!this.statusWaiters.has(datapointId)) {
      return;
    }

    const waiters = Array.from(this.statusWaiters.get(datapointId));
    for (const waiter of waiters) {
      if (version > waiter.minVersion) {
        try {
          waiter.resolve(value, version);
        } catch (error) {
          this.log.debug(`Failed to resolve status waiter for ${datapointId}: ${error.message}`);
        }
      }
    }
  }

  _rejectAllStatusWaiters(error) {
    for (const [datapointId, waiters] of this.statusWaiters.entries()) {
      for (const waiter of waiters) {
        try {
          waiter.reject(error);
        } catch (rejectError) {
          this.log.debug(
            `Failed to reject status waiter for ${datapointId}: ${rejectError.message}`
          );
        }
      }
    }
    this.statusWaiters.clear();
  }

  _sendRequest(buffer, sequence, metadata = {}) {
    const execute = () => {
      if (!this.connected || !this.socket) {
        return Promise.reject(new Error('Not connected to serial bridge'));
      }

      return new Promise((resolve, reject) => {
        const context = metadata.datapointId
          ? `${metadata.operation || 'request'} ${metadata.datapointId}`
          : `sequence ${sequence}`;
        this.log.debug(
          `Sending ${context} to bridge (${buffer.length} bytes): ${formatBuffer(buffer)}`
        );

        const timeoutMs = typeof metadata.timeout === 'number' ? metadata.timeout : 5000;
        const timeout = setTimeout(() => {
          this.pending.delete(sequence);
          this.log.debug(`Timeout waiting for response to ${context} (sequence ${sequence})`);
          reject(new Error('Request timed out'));
        }, timeoutMs);

        this.pending.set(sequence, { resolve, reject, timeout, metadata });

        this.socket.write(buffer, (error) => {
          if (error) {
            clearTimeout(timeout);
            this.pending.delete(sequence);
            this.log.debug(
              `Failed to send ${context} to bridge (sequence ${sequence}): ${error.message}`
            );
            reject(error);
          }
        });
      });
    };

    const queued = this._sendChain.then(execute);
    this._sendChain = queued.catch(() => {});
    return queued;
  }

  _sendFrame(buffer, metadata = {}) {
    const execute = () => {
      if (!this.connected || !this.socket) {
        return Promise.reject(new Error('Not connected to serial bridge'));
      }

      return new Promise((resolve, reject) => {
        const context = metadata.datapointId
          ? `${metadata.operation || 'request'} ${metadata.datapointId}`
          : 'frame';
        this.log.debug(
          `Sending ${context} to bridge (${buffer.length} bytes): ${formatBuffer(buffer)}`
        );

        this.socket.write(buffer, (error) => {
          if (error) {
            this.log.debug(`Failed to send ${context} to bridge: ${error.message}`);
            reject(error);
            return;
          }
          resolve();
        });
      });
    };

    const queued = this._sendChain.then(execute);
    this._sendChain = queued.catch(() => {});
    return queued;
  }

  _waitForStatusValue(datapointId, options = {}) {
    const { timeoutMs = 5000, requireFresh = true, minVersion = null } = options;

    const existing = this.statusValues.get(datapointId);
    if (!requireFresh && existing) {
      return {
        promise: Promise.resolve(existing.value),
        cancel: () => {},
      };
    }

    const baseline =
      minVersion != null ? minVersion : existing ? existing.version : this.statusVersion;

    let settled = false;
    let timeoutHandle = null;
    const waiter = {
      minVersion: baseline,
    };

    const promise = new Promise((resolve, reject) => {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        this._removeStatusWaiter(datapointId, waiter);
        reject(new Error('Status update timeout'));
      }, timeoutMs);

      waiter.resolve = (value) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._removeStatusWaiter(datapointId, waiter);
        resolve(value);
      };

      waiter.reject = (error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeoutHandle);
        this._removeStatusWaiter(datapointId, waiter);
        reject(error);
      };
    });

    this._addStatusWaiter(datapointId, waiter);

    const cancel = (error) => {
      waiter.reject(error || new Error('Cancelled'));
    };

    return { promise, cancel };
  }

  async query(datapointId, params = {}) {
    const definition = REQUESTS[datapointId];
    if (!definition || !definition.query) {
      throw new Error(`Datapoint ${datapointId} cannot be queried`);
    }

    const timeoutMs = typeof params.timeout === 'number' ? params.timeout : 5000;
    const baselineVersion = this.statusVersion;
    const { promise: waitPromise, cancel } = this._waitForStatusValue(datapointId, {
      timeoutMs,
      requireFresh: true,
      minVersion: baselineVersion,
    });

    const { buffer } = encodeFrame(definition.query, params);
    try {
      await this._sendFrame(buffer, {
        datapointId,
        operation: 'query',
        command: definition.query.command,
      });
    } catch (error) {
      cancel(error);
      waitPromise.catch(() => {});
      throw error;
    }

    try {
      const value = await waitPromise;
      return value;
    } catch (error) {
      if (this.statusValues.has(datapointId)) {
        const cached = this.statusValues.get(datapointId);
        this.log.debug(
          `Returning cached value for ${datapointId} after failed wait: ${error.message}`
        );
        return cached.value;
      }
      throw error;
    }
  }

  async set(datapointId, value, params = {}) {
    const definition = REQUESTS[datapointId];
    if (!definition || !definition.set) {
      throw new Error(`Datapoint ${datapointId} is not writeable`);
    }

    const timeoutMs = typeof params.timeout === 'number' ? params.timeout : 5000;
    const baselineVersion = this.statusVersion;
    const { promise: waitPromise, cancel } = this._waitForStatusValue(datapointId, {
      timeoutMs,
      requireFresh: true,
      minVersion: baselineVersion,
    });

    const { buffer } = encodeFrame(definition.set, { value, ...params });
    try {
      await this._sendFrame(buffer, {
        datapointId,
        operation: 'set',
        command: definition.set.command,
      });
    } catch (error) {
      cancel(error);
      waitPromise.catch(() => {});
      throw error;
    }

    try {
      const updated = await waitPromise;
      return updated;
    } catch (error) {
      if (this.statusValues.has(datapointId)) {
        const cached = this.statusValues.get(datapointId);
        this.log.debug(
          `Returning cached value for ${datapointId} after failed wait: ${error.message}`
        );
        return cached.value;
      }
      this.log.debug(
        `Falling back to requested value for ${datapointId} after failed wait: ${error.message}`
      );
      return value;
    }
  }
}

module.exports = {
  MideaSerialBridge,
};
