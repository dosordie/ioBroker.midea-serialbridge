'use strict';

const utils = require('@iobroker/adapter-core');
const { MideaSerialBridge } = require('./lib/midea-serial-bridge');
const { DATA_POINTS } = require('./lib/datapoints');
const { EXIT_CODES } = utils;

const POLLING_METHODS = [
  {
    id: 'getStatus',
    defaultInterval: 60,
  },
  {
    id: 'getCapabilities',
    defaultInterval: 3600,
  },
  {
    id: 'getPowerUsage',
    defaultInterval: 300,
  },
];

const POLLING_METHOD_MAP = new Map(POLLING_METHODS.map((entry) => [entry.id, entry]));

class MideaSerialBridgeAdapter extends utils.Adapter {
  constructor(options = {}) {
    super({
      ...options,
      name: 'midea_serialbridge',
    });

    this.bridge = null;
    this.pollTimers = new Map();
    this.datapointById = new Map(DATA_POINTS.map((dp) => [dp.id, dp]));
    this._terminating = false;
    this._knownCapabilityStates = new Set();

    this._unhandledRejectionHandler = (reason) => {
      const message = this._formatError(reason);
      this.log.error(`Unhandled promise rejection: ${message}`);
      this._terminateAdapter('Unhandled promise rejection', message);
    };

    this._uncaughtExceptionHandler = (error) => {
      const message = this._formatError(error);
      this.log.error(`Uncaught exception: ${message}`);
      this._terminateAdapter('Uncaught exception', message);
    };

    this._registerProcessHandlers();

    this.on('ready', this.onReady.bind(this));
    this.on('stateChange', this.onStateChange.bind(this));
    this.on('unload', this.onUnload.bind(this));
  }

  async onReady() {
    this.log.debug('Adapter ready event triggered');
    try {
      await this.setStateAsync('info.connection', false, true);

      const normalizationResult = this._normalizeConfig();
      if (normalizationResult.changed) {
        await this._persistNormalizedConfig(normalizationResult.normalizedConfig);
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

      this.bridge.on('statusData', (values) => {
        this._applyStatusUpdate(values).catch((error) => {
          this.log.debug(`Failed to process status update: ${error.message}`);
        });
      });

      this.bridge.on('capabilities', (capabilities) => {
        this._applyCapabilities(capabilities).catch((error) => {
          this.log.debug(`Failed to process capabilities update: ${error.message}`);
        });
      });

      this.bridge.on('powerUsage', (usage) => {
        this._applyPowerUsage(usage).catch((error) => {
          this.log.debug(`Failed to process power usage update: ${error.message}`);
        });
      });

      await this.bridge.connect();
    } catch (error) {
      const message = this._formatError(error);
      this.log.error(`Adapter initialization failed: ${message}`);
      this._terminateAdapter('Adapter initialization failed', message);
    }
  }

  async onUnload(callback) {
    this._terminating = true;
    this._unregisterProcessHandlers();
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

  _registerProcessHandlers() {
    process.on('unhandledRejection', this._unhandledRejectionHandler);
    process.on('uncaughtException', this._uncaughtExceptionHandler);
  }

  _unregisterProcessHandlers() {
    if (typeof process.off === 'function') {
      process.off('unhandledRejection', this._unhandledRejectionHandler);
      process.off('uncaughtException', this._uncaughtExceptionHandler);
    } else {
      process.removeListener('unhandledRejection', this._unhandledRejectionHandler);
      process.removeListener('uncaughtException', this._uncaughtExceptionHandler);
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
      const updates = await this.bridge.set(datapointId, value);
      if (updates && typeof updates === 'object' && Object.keys(updates).length > 0) {
        await this._applyStatusUpdate(updates);
      } else {
        await this.setStateAsync(id, { val: value, ack: true });
      }
    } catch (error) {
      this.log.error(`Failed to write ${datapointId}: ${error.message}`);
      this.setState(id, { val: state.val, ack: false, q: 0x21 });
    }
  }

  _terminateAdapter(reason, detail) {
    if (this._terminating) {
      return;
    }
    this._terminating = true;
    try {
      const exitReason = detail ? `${reason}: ${detail}` : reason;
      this.terminate(exitReason, EXIT_CODES.ADAPTER_REQUESTED_TERMINATION);
    } catch (error) {
      const message = this._formatError(error);
      this.log.error(`Failed to terminate adapter cleanly: ${message}`);
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

    await this.setObjectNotExistsAsync('info.connection', {
      type: 'state',
      common: {
        name: 'Connection status',
        type: 'boolean',
        role: 'indicator.connected',
        read: true,
        write: false,
        def: false,
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

    await this.setObjectNotExistsAsync('capabilities', {
      type: 'channel',
      common: {
        name: 'Capabilities',
      },
      native: {},
    });

    await this.setObjectNotExistsAsync('capabilities.raw', {
      type: 'state',
      common: {
        name: 'Capabilities (raw)',
        type: 'string',
        role: 'json',
        read: true,
        write: false,
        def: '',
      },
      native: {},
    });

    const existingCapabilitiesRaw = await this.getStateAsync('capabilities.raw');
    if (!existingCapabilitiesRaw) {
      await this.setStateAsync('capabilities.raw', { val: '', ack: true });
    }

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
    const pollingConfig = this._buildPollingConfig().filter((config) => config.enabled);
    if (pollingConfig.length === 0) {
      this.log.debug('No polling requests enabled; skipping scheduled commands');
      return;
    }

    for (const config of pollingConfig) {
      const method = POLLING_METHOD_MAP.get(config.id);
      if (!method) {
        this.log.debug(`Ignoring unknown polling request ${config.id}`);
        continue;
      }

      const intervalMs = Math.max(config.interval, 5) * 1000;
      this.log.debug(`Scheduling ${config.id} polling every ${intervalMs} ms`);
      const handler = () => this._executePolling(config.id);
      const timer = setInterval(handler, intervalMs);
      this.pollTimers.set(config.id, timer);
      handler();
    }
  }

  _clearPolling() {
    for (const timer of this.pollTimers.values()) {
      clearInterval(timer);
    }
    this.pollTimers.clear();
  }

  _executePolling(methodId) {
    switch (methodId) {
      case 'getStatus':
        this._pollStatus();
        break;
      case 'getCapabilities':
        this._pollCapabilities();
        break;
      case 'getPowerUsage':
        this._pollPowerUsage();
        break;
      default:
        this.log.debug(`No polling handler registered for ${methodId}`);
    }
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

    return POLLING_METHODS.map((method) => {
      const entry = map.get(method.id);
      const fallbackInterval = method.id === 'getStatus' ? defaultInterval : method.defaultInterval;
      return {
        id: method.id,
        enabled: entry ? entry.enabled : method.id === 'getStatus',
        interval: entry ? entry.interval : fallbackInterval,
      };
    });
  }

  _normalizeConfig() {
    if (!this.config || typeof this.config !== 'object') {
      this.config = {};
    }

    const originalConfig = this._deepClone(this.config);
    let changed = false;

    const moveLegacyValue = (legacyKey, targetKey, predicate = () => true) => {
      if (!Object.prototype.hasOwnProperty.call(this.config, legacyKey)) {
        return;
      }

      const legacyValue = this.config[legacyKey];
      if (predicate(legacyValue) && this.config[targetKey] === undefined) {
        this.config[targetKey] = legacyValue;
      }

      delete this.config[legacyKey];
      changed = true;
    };

    if (Object.prototype.hasOwnProperty.call(this.config, '0')) {
      const legacyZero = this.config['0'];
      if (typeof legacyZero === 'string' && this.config.host === undefined) {
        this.config.host = legacyZero;
      } else if (Array.isArray(legacyZero) && !Array.isArray(this.config.pollingRequests)) {
        this.config.pollingRequests = legacyZero;
      }
      delete this.config['0'];
      changed = true;
    }

    moveLegacyValue('1', 'port');
    moveLegacyValue('2', 'pollingInterval');
    moveLegacyValue('3', 'reconnectInterval');
    moveLegacyValue('4', 'customPolling', (value) => typeof value === 'boolean');

    const originalHost = this.config.host;
    let normalizedHost = originalHost;

    const extractHostValue = (entry, visited = new Set()) => {
      if (typeof entry === 'string') {
        return entry;
      }
      if (!entry || typeof entry !== 'object') {
        return '';
      }

      if (visited.has(entry)) {
        return '';
      }
      visited.add(entry);

      const tryValue = (value) => {
        const result = extractHostValue(value, visited);
        if (typeof result === 'string' && result.trim()) {
          return result;
        }
        return '';
      };

      if (Array.isArray(entry)) {
        for (const item of entry) {
          const result = tryValue(item);
          if (result) {
            return result;
          }
        }
        return '';
      }

      for (const key of ['host', 'value', 'label']) {
        if (key in entry) {
          const result = tryValue(entry[key]);
          if (result) {
            return result;
          }
        }
      }

      for (const value of Object.values(entry)) {
        const result = tryValue(value);
        if (result) {
          return result;
        }
      }

      return '';
    };

    if (Array.isArray(normalizedHost)) {
      const arrayHost = extractHostValue(normalizedHost);
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

    const normalizedConfig = this._deepClone(this.config);
    const configChanged = changed || !this._deepEqual(originalConfig, normalizedConfig);

    return {
      changed: configChanged,
      normalizedConfig,
    };
  }

  async _persistNormalizedConfig(normalizedConfig) {
    try {
      const objectId = `system.adapter.${this.namespace}`;
      const adapterObject = await this.getForeignObjectAsync(objectId);
      if (!adapterObject) {
        return;
      }

      if (this._deepEqual(adapterObject.native, normalizedConfig)) {
        return;
      }

      adapterObject.native = this._deepClone(normalizedConfig);
      await this.setForeignObjectAsync(objectId, adapterObject);
    } catch (error) {
      this.log.warn(`Failed to persist normalized config: ${error.message}`);
    }
  }

  _deepClone(value, seen = new WeakMap()) {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (seen.has(value)) {
      return seen.get(value);
    }

    if (Array.isArray(value)) {
      const clonedArray = [];
      seen.set(value, clonedArray);
      for (const item of value) {
        clonedArray.push(this._deepClone(item, seen));
      }
      return clonedArray;
    }

    const clonedObject = {};
    seen.set(value, clonedObject);
    for (const key of Object.keys(value)) {
      clonedObject[key] = this._deepClone(value[key], seen);
    }
    return clonedObject;
  }

  _deepEqual(a, b, visited = new WeakMap()) {
    if (a === b) {
      return true;
    }

    if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
      return false;
    }

    if (visited.has(a)) {
      return visited.get(a) === b;
    }
    visited.set(a, b);

    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) {
        return false;
      }

      for (let i = 0; i < a.length; i++) {
        if (!this._deepEqual(a[i], b[i], visited)) {
          return false;
        }
      }
      return true;
    }

    if (Array.isArray(b)) {
      return false;
    }

    const aKeys = Object.keys(a);
    const bKeys = Object.keys(b);

    if (aKeys.length !== bKeys.length) {
      return false;
    }

    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) {
        return false;
      }
      if (!this._deepEqual(a[key], b[key], visited)) {
        return false;
      }
    }

    return true;
  }

  async _pollStatus() {
    if (!this.bridge || !this.bridge.connected) {
      return;
    }

    try {
      await this.bridge.getStatus();
    } catch (error) {
      this.log.warn(`Polling status failed: ${error.message}`);
    }
  }

  async _pollCapabilities() {
    if (!this.bridge || !this.bridge.connected) {
      return;
    }

    try {
      await this.bridge.getCapabilities();
    } catch (error) {
      this.log.warn(`Polling capabilities failed: ${error.message}`);
    }
  }

  async _pollPowerUsage() {
    if (!this.bridge || !this.bridge.connected) {
      return;
    }

    try {
      await this.bridge.getPowerUsage();
    } catch (error) {
      this.log.warn(`Polling power usage failed: ${error.message}`);
    }
  }

  async _applyStatusUpdate(status) {
    if (!status || typeof status !== 'object') {
      return;
    }

    const entries =
      status.values && typeof status.values === 'object'
        ? Object.entries(status.values)
        : Object.entries(status);

    for (const [datapointId, value] of entries) {
      if (!this.datapointById.has(datapointId)) {
        continue;
      }

      const datapoint = this.datapointById.get(datapointId);
      const normalized = this._normalizeReadValue(datapoint, value);
      try {
        await this.setStateAsync(`${datapoint.channel}.${datapoint.id}`, {
          val: normalized,
          ack: true,
        });
      } catch (error) {
        this.log.debug(`Failed to update state ${datapointId} from status frame: ${error.message}`);
      }
    }
  }

  async _applyCapabilities(capabilities) {
    if (!capabilities || typeof capabilities !== 'object') {
      return;
    }

    try {
      await this.setStateAsync('capabilities.raw', {
        val: JSON.stringify(capabilities),
        ack: true,
      });
    } catch (error) {
      this.log.debug(`Failed to update capabilities.raw: ${error.message}`);
    }

    for (const [key, value] of Object.entries(capabilities)) {
      try {
        await this._ensureCapabilityState(key, value);
        await this.setStateAsync(`capabilities.${key}`, { val: value, ack: true });
      } catch (error) {
        this.log.debug(`Failed to update capability ${key}: ${error.message}`);
      }
    }
  }

  async _applyPowerUsage(usage) {
    if (!usage || typeof usage !== 'object') {
      return;
    }

    if (!this.datapointById.has('powerUsage')) {
      return;
    }

    const datapoint = this.datapointById.get('powerUsage');
    const normalized = this._normalizeReadValue(datapoint, usage.powerUsage);
    try {
      await this.setStateAsync(`${datapoint.channel}.${datapoint.id}`, {
        val: normalized,
        ack: true,
      });
    } catch (error) {
      this.log.debug(`Failed to update power usage state: ${error.message}`);
    }
  }

  async _ensureCapabilityState(key, value) {
    if (this._knownCapabilityStates.has(key)) {
      return;
    }

    const valueType = typeof value;
    let type = 'string';
    let role = 'text';

    if (valueType === 'boolean') {
      type = 'boolean';
      role = 'indicator';
    } else if (valueType === 'number') {
      type = 'number';
      role = 'value';
    }

    await this.setObjectNotExistsAsync(`capabilities.${key}`, {
      type: 'state',
      common: {
        name: key,
        type,
        role,
        read: true,
        write: false,
      },
      native: {},
    });

    this._knownCapabilityStates.add(key);
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

    if (datapoint.type === 'string') {
      if (value == null) {
        return '';
      }
      return String(value).trim();
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

    if (datapoint.type === 'string') {
      if (value == null) {
        return '';
      }
      return String(value);
    }

    return value;
  }

  _formatError(error) {
    if (!error) {
      return 'Unknown error';
    }

    if (error instanceof Error) {
      return error.stack || `${error.name}: ${error.message}`;
    }

    if (typeof error === 'object') {
      try {
        return JSON.stringify(error);
      } catch (jsonError) {
        return String(error);
      }
    }

    return String(error);
  }
}

if (module.parent) {
  module.exports = (options) => new MideaSerialBridgeAdapter(options);
} else {
  new MideaSerialBridgeAdapter();
}
