'use strict';

const net = require('net');
const EventEmitter = require('events');
const { encodeFrame, decodeFrame, REQUESTS } = require('./protocol');

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
      this._scheduleReconnect();
      this.emit('error', error);
    });

    this.socket.on('close', () => {
      this.log.warn('Serial bridge connection closed');
      this.connected = false;
      this.socket = null;
      this.emit('disconnected');
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
      this.log.warn(`Received invalid frame: ${frame.error}`);
      return;
    }

    const key = frame.sequence != null ? frame.sequence : null;

    if (key && this.pending.has(key)) {
      const { resolve, reject, timeout } = this.pending.get(key);
      clearTimeout(timeout);
      this.pending.delete(key);

      if (frame.type === 'error') {
        reject(new Error(frame.message || 'Bridge returned an error'));
        return;
      }

      resolve(frame.payload);
      return;
    }

    this.emit('frame', frame, rawFrame);
  }

  _sendRequest(buffer, sequence) {
    if (!this.connected || !this.socket) {
      return Promise.reject(new Error('Not connected to serial bridge'));
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(sequence);
        reject(new Error('Request timed out'));
      }, 5000);

      this.pending.set(sequence, { resolve, reject, timeout });

      this.socket.write(buffer);
    });
  }

  async query(datapointId, params = {}) {
    const definition = REQUESTS[datapointId];
    if (!definition || !definition.query) {
      throw new Error(`Datapoint ${datapointId} cannot be queried`);
    }

    const { buffer, sequence } = encodeFrame(definition.query, params);
    const payload = await this._sendRequest(buffer, sequence);
    if (definition.parse) {
      return definition.parse(payload, params);
    }

    return payload;
  }

  async set(datapointId, value, params = {}) {
    const definition = REQUESTS[datapointId];
    if (!definition || !definition.set) {
      throw new Error(`Datapoint ${datapointId} is not writeable`);
    }

    const { buffer, sequence } = encodeFrame(definition.set, { value, ...params });
    const payload = await this._sendRequest(buffer, sequence);
    if (definition.parse) {
      return definition.parse(payload, params);
    }

    return payload;
  }
}

module.exports = {
  MideaSerialBridge,
};

