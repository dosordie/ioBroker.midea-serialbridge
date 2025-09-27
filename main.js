'use strict';

const utils = require('@iobroker/adapter-core');
const { MideaSerialBridge } = require('./lib/midea-serial-bridge');
const { DATA_POINTS } = require('./lib/datapoints');

class MideaSerialBridgeAdapter extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'midea_serialbridge',
    });

    this.bridge = null;
    this.pollTimers = new Map();
    this.datapointById = new Map(DATA_POINTS.map((dp) => [dp.id, dp]));

    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  async onReady() {
    this.log.debug('Adapter ready event triggered');
    await this.setStateAsync('info.connection', false, true);

    const configChanged = this._normalizeConfig();
    if (configChanged) {
      await this._persistNormalizedConfig();
    }

    if (!this.config || !this.config.host) {
      this.log.error('No host configured. Please enter the IP address of the serial bridge.');
      return;
    }

    await this._ensureObjects();
    this.subscribeStates('*');

    this.bridge = new MideaSerialBridge({
      host: this.config.host,
      port: Number(this.config.port) || 23,
      reconnectInterval: (Number(this.config.reconnectInterval) || 10) * 1000,
      log: this.log,
    });

    this.bridge.on('connected', () => {
      this.log.info('Serial bridge connection established');
      this.setStateAsync('info.connection', true, true);
      this._startPolling();
    });

    this.bridge.on('disconnected', () => {
      this.log.warn('Serial bridge disconnected');
      this.setStateAsync('info.connection', false, true);
      this._clearPolling();
    });

    this.bridge.on('error', (error) => {
      this.log.error(`Serial bridge error: ${error.message}`);
    });

    this.bridge.connect();
  }

  async onUnload(callback) {
    try {
      this._clearPolling();
      if (this.bridge) {
        this.bridge.disconnect();
      }
      callback();
    } catch (error) {
      callback();
    }
  }

  async onStateChange(id, state) {
    if (!state || state.ack || !this.bridge) {
      return;
    }

    if (!id.startsWith(`${this.namespace}.`)) {
      return;
    }

    const relativeId = id.slice(this.namespace.length + 1);
    const [, datapointId] = relativeId.split('.');
    if (!datapointId || !this.datapointById.has(datapointId)) {
      return;
    }

    const datapoint = this.datapointById.get(datapointId);
    if (!datapoint.write) {
      this.log.debug(`State ${datapointId} is read only`);
      return;
    }

    try {
      const value = this._normalizeWriteValue(datapoint, state.val);
      this.log.debug(`Forwarding command ${datapointId} with value ${JSON.stringify(value)}`);
      await this.bridge.set(datapointId, value);
      await this.setStateAsync(id, { val: value, ack: true });
    } catch (error) {
      this.log.error(`Failed to write ${datapointId}: ${error.message}`);
      this.setState(id, { val: state.val, ack: false, q: 0x21 });
    }
  }

  async _ensureObjects() {
    await this.setObjectNotExistsAsync('info', {
      type: 'channel',
      common: {
        name: 'Information',
      },
      native: {},
    });

    await this.setObjectNotExistsAsync('control', {
      type: 'channel',
      common: {
        name: 'Controls',
      },
      native: {},
    });

    await this.setObjectNotExistsAsync('sensors', {
      type: 'channel',
      common: {
        name: 'Sensors',
      },
      native: {},
    });

    for (const datapoint of DATA_POINTS) {
      const stateId = `${datapoint.channel}.${datapoint.id}`;
      const common = {
        name: datapoint.name,
        role: datapoint.role,
        type: datapoint.type,
        read: true,
        write: !!datapoint.write,
        def: datapoint.def,
      };

      if (datapoint.unit) {
        common.unit = datapoint.unit;
      }
      if (datapoint.states) {
        common.states = datapoint.states;
      }
      if (typeof datapoint.min === 'number') {
        common.min = datapoint.min;
      }
      if (typeof datapoint.max === 'number') {
        common.max = datapoint.max;
      }
      if (typeof datapoint.step === 'number') {
        common.step = datapoint.step;
      }

      await this.setObjectNotExistsAsync(stateId, {
        type: 'state',
        common,
        native: {},
      });

      const existingState = await this.getStateAsync(stateId);
      if (!existingState) {
        await this.setStateAsync(stateId, { val: null, ack: true });
      }
    }
  }

  _startPolling() {
    this._clearPolling();
    const pollingConfig = this._buildPollingConfig();
    for (const config of pollingConfig) {
      if (!config.enabled) {
        continue;
      }
      const intervalMs = Math.max(config.interval, 5) * 1000;
      this.log.debug(`Scheduling polling for ${config.id} every ${intervalMs} ms`);
      const timer = setInterval(() => this._pollDatapoint(config.id), intervalMs);
      this.pollTimers.set(config.id, timer);
      this._pollDatapoint(config.id);
    }
  }

  _clearPolling() {
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
  }

  _buildPollingConfig() {
    const defaultInterval = Number(this.config.pollingInterval) || 60;
    const entries = this._getPollingEntries();
    const map = new Map();
    for (const entry of entries) {
      if (!entry || !entry.id) {
        continue;
      }
      map.set(entry.id, {
        enabled: entry.enabled !== false,
        interval: Number(entry.interval) || defaultInterval,
      });
    }

    return DATA_POINTS.filter((dp) => dp.pollable).map((dp) => {
      const entry = map.get(dp.id);
      return {
        id: dp.id,
        enabled: entry ? entry.enabled : true,
        interval: entry ? entry.interval : defaultInterval,
      };
    });
  }

  _normalizeConfig() {
    let changed = false;

    const originalHost = this.config.host;
    let normalizedHost = originalHost;

    const extractHostValue = (entry) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (!entry || typeof entry !== 'object') {
        return '';
      }

      if (typeof entry.host === 'string') {
        return entry.host;
      }
      if (typeof entry.value === 'string') {
        return entry.value;
      }
      if (typeof entry.label === 'string') {
        return entry.label;
      }

      return '';
    };

    if (Array.isArray(normalizedHost)) {
      const arrayHost = normalizedHost
        .map((entry) => extractHostValue(entry))
        .find((value) => typeof value === 'string' && value.trim());
      normalizedHost = arrayHost || '';
    } else if (normalizedHost && typeof normalizedHost === 'object') {
      normalizedHost = extractHostValue(normalizedHost);
    } else if (typeof normalizedHost !== 'string') {
      normalizedHost = '';
    }

    if (typeof normalizedHost === 'string' && normalizedHost.includes('[object Object]')) {
      normalizedHost = '';
    }

    if (normalizedHost !== originalHost) {
      this.config.host = normalizedHost;
      changed = true;
    }

    const pollingIsObject = this.config.polling && typeof this.config.polling === 'object';
    const existingRequests =
      pollingIsObject && Array.isArray(this.config.polling.requests)
        ? this.config.polling.requests
        : null;

    if (!existingRequests && Array.isArray(this.config.pollingRequests)) {
      this.config.polling = {
        ...(pollingIsObject ? this.config.polling : {}),
        requests: this.config.pollingRequests,
      };
      changed = true;
    }

    if (
      typeof this.config.customPolling !== 'boolean' &&
      this.config.polling &&
      typeof this.config.polling.customPolling === 'boolean'
    ) {
      this.config.customPolling = this.config.polling.customPolling;
      changed = true;
    }

    if (
      this.config.polling &&
      Array.isArray(this.config.polling.requests) &&
      !Array.isArray(this.config.pollingRequests)
    ) {
      this.config.pollingRequests = this.config.polling.requests.map((entry) => ({
        id: entry.id,
        enabled: entry.enabled !== false,
        interval: Number(entry.interval) || Number(this.config.pollingInterval) || 60,
      }));
      changed = true;
    }

    return changed;
  }

  async _persistNormalizedConfig() {
    try {
      await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
        native: this.config,
      });
    } catch (error) {
      this.log.warn(`Failed to persist normalized config: ${error.message}`);
    }
  }

  async _pollDatapoint(datapointId) {
    if (!this.bridge || !this.bridge.connected) {
      return;
    }

    const datapoint = this.datapointById.get(datapointId);
    if (!datapoint) {
      return;
    }

    try {
      const value = await this.bridge.query(datapointId);
      const normalized = this._normalizeReadValue(datapoint, value);
      await this.setStateAsync(`${datapoint.channel}.${datapoint.id}`, {
        val: normalized,
        ack: true,
      });
    } catch (error) {
      this.log.warn(`Polling ${datapointId} failed: ${error.message}`);
    }
  }

  _getPollingEntries() {
    if (this.config.polling && Array.isArray(this.config.polling.requests)) {
      return this.config.polling.requests;
    }
    if (Array.isArray(this.config.pollingRequests)) {
      return this.config.pollingRequests;
    }
    return [];
  }

  _normalizeWriteValue(datapoint, value) {
    if (datapoint.type === 'boolean') {
      return value === 'true' || value === true || value === 1;
    }

    if (datapoint.type === 'number') {
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric value ${value}`);
      }
      return parsed;
    }

    return value;
  }

  _normalizeReadValue(datapoint, value) {
    if (datapoint.type === 'boolean') {
      return !!value;
    }

    if (datapoint.type === 'number') {
      return Number(value);
    }

    return value;
  }
}

if (module.parent) {
  module.exports = (options) => new MideaSerialBridgeAdapter(options);
} else {
  new MideaSerialBridgeAdapter();
}
