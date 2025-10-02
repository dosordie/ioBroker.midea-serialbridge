'use strict';

const utils = require('@iobroker/adapter-core');
const { isDeepStrictEqual } = require('node:util');
const { MideaSerialBridge } = require('./lib/midea-serial-bridge');
const { DATA_POINTS } = require('./lib/datapoints');
const {
  MODE_ALIASES,
  MODE_NAME_TO_VALUE,
  MODE_NAME_TO_LEGACY_VALUE,
  MODE_VALUE_TO_NAME,
  LEGACY_MODE_NUMBERS,
  FAN_SPEED_ALIASES,
  FAN_SPEED_NAME_TO_VALUE,
  FAN_SPEED_VALUE_TO_NAME,
  SWING_ALIASES,
  SWING_NAME_TO_VALUE,
  SWING_VALUE_TO_NAME,
  normalizeString,
} = require('./lib/value-mappings');
const { EXIT_CODES } = utils;

function normalizeBooleanValue(value) {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return false;
    }
    if (normalized === 'true' || normalized === '1') {
      return true;
    }
    if (normalized === 'false' || normalized === '0') {
      return false;
    }
  }

  return value === true || value === 1;
}

function cloneRecursively(value, seen) {
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
      clonedArray.push(cloneRecursively(item, seen));
    }
    return clonedArray;
  }

  const clonedObject = {};
  seen.set(value, clonedObject);
  for (const key of Object.keys(value)) {
    clonedObject[key] = cloneRecursively(value[key], seen);
  }
  return clonedObject;
}

function deepClone(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }

  if (typeof globalThis.structuredClone === 'function') {
    try {
      return globalThis.structuredClone(value);
    } catch (_error) {
      // Fallback to manual cloning below if structuredClone cannot handle the value
    }
  }

  return cloneRecursively(value, new WeakMap());
}

function cloneDatapointDefinition(datapoint) {
  const clone = { ...datapoint };
  if (datapoint.states) {
    clone.states = { ...datapoint.states };
  }
  return clone;
}

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
      name: 'midea-serialbridge',
    });

    this.bridge = null;
    this.pollTimers = new Map();
    this.datapoints = DATA_POINTS.map((dp) => cloneDatapointDefinition(dp));
    this.datapointById = new Map(this.datapoints.map((dp) => [dp.id, dp]));
    this._terminating = false;
    this._knownCapabilityStates = new Set();
    this._knownRawStatusStates = new Set();
    this.valueRepresentation = { mode: false, fanSpeed: false, swingMode: false };

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

      this._applyValueRepresentationConfig();

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
        beepOnCommand: this.config.beep !== false,
        valueRepresentation: this.valueRepresentation,
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

      this.bridge.on('statusData', (values, rawStatus) => {
        this._applyStatusUpdate(values, rawStatus).catch((error) => {
          this.log.debug(`Failed to process status update: ${this._formatError(error)}`);
        });
      });

      this.bridge.on('capabilities', (capabilities) => {
        this._applyCapabilities(capabilities).catch((error) => {
          this.log.debug(`Failed to process capabilities update: ${this._formatError(error)}`);
        });
      });

      this.bridge.on('powerUsage', (usage) => {
        this._applyPowerUsage(usage).catch((error) => {
          this.log.debug(`Failed to process power usage update: ${this._formatError(error)}`);
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

    if (relativeId === 'control.command') {
      await this._handleCommandState(id, state.val);
      return;
    }

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
      this.log.error(`Failed to write ${datapointId}: ${this._formatError(error)}`);
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

    await this.setObjectNotExistsAsync('control.command', {
      type: 'state',
      common: {
        name: 'JSON command input',
        type: 'string',
        role: 'json',
        read: false,
        write: true,
        def: '',
      },
      native: {},
    });

    const existingCommand = await this.getStateAsync('control.command');
    if (!existingCommand) {
      await this.setStateAsync('control.command', { val: '', ack: true });
    }

    await this.setObjectNotExistsAsync('sensors', {
      type: 'channel',
      common: {
        name: 'Sensors',
      },
      native: {},
    });

    await this.setObjectNotExistsAsync('statusRaw', {
      type: 'channel',
      common: {
        name: 'Raw status values',
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

    for (const datapoint of this.datapoints) {
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

      const updateCommon = { ...common };
      if (!datapoint.states) {
        delete updateCommon.states;
      }
      if (typeof datapoint.min !== 'number') {
        delete updateCommon.min;
      }
      if (typeof datapoint.max !== 'number') {
        delete updateCommon.max;
      }
      if (typeof datapoint.step !== 'number') {
        delete updateCommon.step;
      }
      await this.extendObjectAsync(stateId, { common: updateCommon });
      await this._normalizeStateBoundaries(stateId, datapoint);

      const existingState = await this.getStateAsync(stateId);
      if (!existingState) {
        await this.setStateAsync(stateId, { val: null, ack: true });
      }
    }
  }

  async _normalizeStateBoundaries(stateId, datapoint) {
    try {
      const object = await this.getObjectAsync(stateId);
      if (!object || !object.common) {
        return;
      }

      const updatedCommon = { ...object.common };
      let changed = false;

      for (const key of ['min', 'max', 'step']) {
        if (typeof datapoint[key] === 'number') {
          if (updatedCommon[key] !== datapoint[key]) {
            updatedCommon[key] = datapoint[key];
            changed = true;
          }
        } else if (Object.prototype.hasOwnProperty.call(updatedCommon, key)) {
          delete updatedCommon[key];
          changed = true;
        }
      }

      if (changed) {
        await this.setObjectAsync(stateId, {
          ...object,
          common: updatedCommon,
        });
      }
    } catch (error) {
      this.log.warn(
        `Failed to normalize state boundaries for ${stateId}: ${this._formatError(error)}`
      );
    }
  }

  async _handleCommandState(stateId, rawValue) {
    if (!this.bridge) {
      this.log.warn('Ignoring command because bridge is not connected yet');
      return;
    }

    let parsedValue = rawValue;

    if (typeof parsedValue === 'string') {
      const trimmed = parsedValue.trim();
      if (!trimmed) {
        await this.setStateAsync(stateId, { val: '', ack: true });
        return;
      }

      const normalizedJson = trimmed.includes('?') ? trimmed.replace(/\?/g, '"') : trimmed;

      try {
        parsedValue = JSON.parse(normalizedJson);
      } catch (error) {
        this.log.error(`Failed to parse JSON command: ${this._formatError(error)}`);
        this.setState(stateId, { val: rawValue, ack: true, q: 0x21 });
        return;
      }
    }

    if (!parsedValue || typeof parsedValue !== 'object' || Array.isArray(parsedValue)) {
      this.log.error('JSON command must be an object with key/value pairs');
      this.setState(stateId, { val: rawValue, ack: true, q: 0x21 });
      return;
    }

    try {
      const updates = await this.bridge.sendCommand(parsedValue);
      if (updates && typeof updates === 'object' && Object.keys(updates).length > 0) {
        await this._applyStatusUpdate(updates);
      }

      await this.setStateAsync(stateId, {
        val: JSON.stringify(parsedValue),
        ack: true,
      });
    } catch (error) {
      this.log.error(`Failed to execute JSON command: ${this._formatError(error)}`);
      this.setState(stateId, { val: rawValue, ack: true, q: 0x21 });
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

    const originalConfig = deepClone(this.config);
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

    if (typeof normalizedHost === 'string') {
      if (normalizedHost.includes('[object Object]')) {
        normalizedHost = '';
      } else {
        const trimmedHost = normalizedHost.trim();
        if (trimmedHost !== normalizedHost) {
          normalizedHost = trimmedHost;
        }
      }
    }

    if (normalizedHost !== originalHost) {
      this.config.host = normalizedHost;
      changed = true;
    }

    const normalizeInteger = (value, fallback, min, max) => {
      const numericValue = Number(value);
      if (!Number.isFinite(numericValue)) {
        return fallback;
      }

      let roundedValue = Math.round(numericValue);
      if (typeof min === 'number') {
        roundedValue = Math.max(roundedValue, min);
      }
      if (typeof max === 'number') {
        roundedValue = Math.min(roundedValue, max);
      }

      return roundedValue;
    };

    const normalizedPort = normalizeInteger(this.config.port, 23, 1, 65535);
    if (normalizedPort !== this.config.port) {
      this.config.port = normalizedPort;
      changed = true;
    }

    const normalizedPollingInterval = normalizeInteger(this.config.pollingInterval, 60, 5, 3600);
    if (normalizedPollingInterval !== this.config.pollingInterval) {
      this.config.pollingInterval = normalizedPollingInterval;
      changed = true;
    }

    const normalizedReconnectInterval = normalizeInteger(this.config.reconnectInterval, 10, 1, 600);
    if (normalizedReconnectInterval !== this.config.reconnectInterval) {
      this.config.reconnectInterval = normalizedReconnectInterval;
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

    if (typeof this.config.exposeRawStatus !== 'boolean') {
      const rawValue = this.config.exposeRawStatus;
      const normalizedExposeRawStatus = normalizeBooleanValue(rawValue);
      if (normalizedExposeRawStatus !== rawValue || rawValue === undefined) {
        this.config.exposeRawStatus = normalizedExposeRawStatus;
        changed = true;
      }
    }

    for (const key of ['modeAsNumber', 'fanSpeedAsNumber', 'swingModeAsNumber']) {
      if (typeof this.config[key] !== 'boolean') {
        const normalized = normalizeBooleanValue(this.config[key]);
        if (normalized !== this.config[key]) {
          this.config[key] = normalized;
          changed = true;
        }
      }
    }

    const normalizedConfig = deepClone(this.config);
    const configChanged = changed || !isDeepStrictEqual(originalConfig, normalizedConfig);

    return {
      changed: configChanged,
      normalizedConfig,
    };
  }

  _applyValueRepresentationConfig() {
    const representation = {
      mode: !!(this.config && this.config.modeAsNumber),
      fanSpeed: !!(this.config && this.config.fanSpeedAsNumber),
      swingMode: !!(this.config && this.config.swingModeAsNumber),
    };

    this.valueRepresentation = representation;

    this.datapoints = DATA_POINTS.map((datapoint) => {
      const clone = cloneDatapointDefinition(datapoint);

      switch (clone.id) {
        case 'mode':
          if (representation.mode) {
            clone.type = 'number';
            clone.states = {
              0: 'auto (legacy)',
              1: 'auto',
              2: 'cool',
              3: 'dry',
              4: 'heat',
              5: 'fanonly',
              6: 'customdry',
            };
          }
          break;
        case 'fanSpeed':
          if (representation.fanSpeed) {
            clone.type = 'number';
            clone.states = {
              20: 'silent',
              40: 'low',
              60: 'medium',
              80: 'high',
              101: 'fixed',
              102: 'auto',
            };
          }
          break;
        case 'swingMode':
          if (representation.swingMode) {
            clone.type = 'number';
            clone.states = {
              0: 'off',
              1: 'vertical',
              2: 'horizontal',
              3: 'both',
            };
          }
          break;
        default:
          break;
      }

      return clone;
    });

    this.datapointById = new Map(this.datapoints.map((datapoint) => [datapoint.id, datapoint]));
  }

  async _persistNormalizedConfig(normalizedConfig) {
    try {
      const objectId = `system.adapter.${this.namespace}`;
      const adapterObject = await this.getForeignObjectAsync(objectId);
      if (!adapterObject) {
        return;
      }

      if (isDeepStrictEqual(adapterObject.native, normalizedConfig)) {
        return;
      }

      adapterObject.native = deepClone(normalizedConfig);
      await this.setForeignObjectAsync(objectId, adapterObject);
    } catch (error) {
      this.log.warn(`Failed to persist normalized config: ${error.message}`);
    }
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

  _extractStatusEntries(status) {
    if (!status || typeof status !== 'object') {
      return null;
    }

    const container = status.values && typeof status.values === 'object' ? status.values : status;

    if (!container || typeof container !== 'object') {
      return null;
    }

    try {
      return Object.entries(container);
    } catch (error) {
      this.log.debug(`Failed to extract status entries: ${this._formatError(error)}`);
      return null;
    }
  }

  async _applyStatusUpdate(status, rawStatus) {
    const entries = this._extractStatusEntries(status);
    if (!entries || entries.length === 0) {
      return;
    }

    if (this.config && this.config.exposeRawStatus) {
      const rawEntries = this._extractStatusEntries(rawStatus) || (!rawStatus ? entries : null);
      if (rawEntries && rawEntries.length > 0) {
        await this._applyRawStatus(rawEntries);
      }
    }

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
        this.log.debug(
          `Failed to update state ${datapointId} from status frame: ${this._formatError(error)}`
        );
      }
    }
  }

  async _applyRawStatus(entries) {
    if (!Array.isArray(entries) || entries.length === 0) {
      return;
    }

    for (const [key, value] of entries) {
      if (this.datapointById.has(key)) {
        continue;
      }

      try {
        const normalized = this._normalizeRawStatusValue(value);
        if (!normalized) {
          continue;
        }

        const { value: normalizedValue, type, role } = normalized;
        await this._ensureRawStatusState(key, type, role);
        await this.setStateAsync(`statusRaw.${key}`, { val: normalizedValue, ack: true });
      } catch (error) {
        this.log.debug(`Failed to update raw status ${key}: ${this._formatError(error)}`);
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
      this.log.debug(`Failed to update capabilities.raw: ${this._formatError(error)}`);
    }

    for (const [key, value] of Object.entries(capabilities)) {
      try {
        await this._ensureCapabilityState(key, value);
        await this.setStateAsync(`capabilities.${key}`, { val: value, ack: true });
      } catch (error) {
        this.log.debug(`Failed to update capability ${key}: ${this._formatError(error)}`);
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
      this.log.debug(`Failed to update power usage state: ${this._formatError(error)}`);
    }
  }

  async _ensureRawStatusState(key, type, role) {
    if (this._knownRawStatusStates.has(key)) {
      return;
    }

    await this.setObjectNotExistsAsync(`statusRaw.${key}`, {
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

    this._knownRawStatusStates.add(key);
  }

  _normalizeRawStatusValue(value) {
    if (value === undefined) {
      return null;
    }

    if (typeof value === 'boolean') {
      return { value: !!value, type: 'boolean', role: 'indicator' };
    }

    if (typeof value === 'number') {
      const numeric = Number(value);
      if (Number.isNaN(numeric)) {
        return null;
      }
      return { value: numeric, type: 'number', role: 'value' };
    }

    if (typeof value === 'bigint') {
      return { value: value.toString(), type: 'string', role: 'text' };
    }

    if (typeof value === 'string') {
      return { value: value, type: 'string', role: 'text' };
    }

    if (typeof value === 'object') {
      let serialized;
      try {
        serialized = JSON.stringify(value);
      } catch (error) {
        serialized = String(value);
      }
      return { value: serialized, type: 'string', role: 'json' };
    }

    return { value: String(value), type: 'string', role: 'text' };
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
    if (['mode', 'fanSpeed', 'swingMode'].includes(datapoint.id)) {
      return this._normalizeEnumWriteValue(datapoint.id, value);
    }

    if (datapoint.type === 'boolean') {
      return normalizeBooleanValue(value);
    }

    if (datapoint.type === 'number') {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const parsed = Number(value);
      if (Number.isNaN(parsed)) {
        throw new Error(`Invalid numeric value ${value}`);
      }
      let normalized = parsed;
      if (typeof datapoint.min === 'number' && normalized < datapoint.min) {
        normalized = datapoint.min;
      }
      if (typeof datapoint.max === 'number' && normalized > datapoint.max) {
        normalized = datapoint.max;
      }
      return normalized;
    }

    if (datapoint.type === 'string') {
      if (value == null) {
        return '';
      }
      return String(value).trim();
    }

    return value;
  }

  _normalizeEnumWriteValue(datapointId, rawValue) {
    const useNumeric = !!(this.valueRepresentation && this.valueRepresentation[datapointId]);

    if (rawValue === null || rawValue === undefined) {
      return useNumeric ? null : '';
    }

    if (useNumeric) {
      const numericValue = this._convertToNumericRepresentation(datapointId, rawValue);
      if (numericValue !== undefined) {
        return numericValue;
      }
    } else {
      const stringValue = this._convertToStringRepresentation(datapointId, rawValue);
      if (stringValue !== undefined) {
        return stringValue;
      }
    }

    if (typeof rawValue === 'string') {
      return rawValue.trim();
    }

    return rawValue;
  }

  _convertToNumericRepresentation(datapointId, rawValue) {
    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      return rawValue;
    }

    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return null;
      }

      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        return numeric;
      }

      const normalizedName = this._normalizeEnumName(datapointId, trimmed);
      if (normalizedName) {
        const mapped = this._mapEnumNameToNumber(datapointId, normalizedName);
        if (mapped !== undefined) {
          return mapped;
        }
      }
    }

    return undefined;
  }

  _convertToStringRepresentation(datapointId, rawValue) {
    if (typeof rawValue === 'string') {
      const trimmed = rawValue.trim();
      if (!trimmed) {
        return '';
      }

      const normalizedName = this._normalizeEnumName(datapointId, trimmed);
      if (normalizedName) {
        return normalizedName;
      }

      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        const mapped = this._mapEnumNumberToName(datapointId, numeric);
        if (mapped !== undefined) {
          return mapped;
        }
      }

      return trimmed;
    }

    if (typeof rawValue === 'number' && Number.isFinite(rawValue)) {
      const mapped = this._mapEnumNumberToName(datapointId, rawValue);
      if (mapped !== undefined) {
        return mapped;
      }
      return String(rawValue);
    }

    return undefined;
  }

  _normalizeEnumName(datapointId, value) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }

    switch (datapointId) {
      case 'mode':
        if (MODE_ALIASES[normalized]) {
          return MODE_ALIASES[normalized];
        }
        if (MODE_VALUE_TO_NAME[Number(normalized)]) {
          return MODE_VALUE_TO_NAME[Number(normalized)];
        }
        if (LEGACY_MODE_NUMBERS[Number(normalized)]) {
          return LEGACY_MODE_NUMBERS[Number(normalized)];
        }
        if (
          MODE_NAME_TO_VALUE[normalized] !== undefined ||
          MODE_NAME_TO_LEGACY_VALUE[normalized] !== undefined
        ) {
          return normalized;
        }
        break;
      case 'fanSpeed':
        if (FAN_SPEED_ALIASES[normalized]) {
          return FAN_SPEED_ALIASES[normalized];
        }
        if (FAN_SPEED_NAME_TO_VALUE[normalized] !== undefined) {
          return normalized;
        }
        break;
      case 'swingMode':
        if (SWING_ALIASES[normalized]) {
          const alias = SWING_ALIASES[normalized];
          return this._mapSwingAliasToName(alias);
        }
        if (SWING_NAME_TO_VALUE[normalized] !== undefined) {
          return normalized;
        }
        break;
      default:
        break;
    }

    return undefined;
  }

  _mapEnumNameToNumber(datapointId, name) {
    switch (datapointId) {
      case 'mode':
        if (MODE_NAME_TO_VALUE[name] !== undefined) {
          return MODE_NAME_TO_VALUE[name];
        }
        if (MODE_NAME_TO_LEGACY_VALUE[name] !== undefined) {
          return MODE_NAME_TO_LEGACY_VALUE[name];
        }
        return undefined;
      case 'fanSpeed':
        return FAN_SPEED_NAME_TO_VALUE[name];
      case 'swingMode':
        return SWING_NAME_TO_VALUE[name];
      default:
        return undefined;
    }
  }

  _mapEnumNumberToName(datapointId, numeric) {
    if (!Number.isFinite(numeric)) {
      return undefined;
    }
    const value = Number(numeric);

    switch (datapointId) {
      case 'mode':
        return MODE_VALUE_TO_NAME[value] || LEGACY_MODE_NUMBERS[value];
      case 'fanSpeed':
        return FAN_SPEED_VALUE_TO_NAME[value];
      case 'swingMode':
        return SWING_VALUE_TO_NAME[value];
      default:
        return undefined;
    }
  }

  _mapSwingAliasToName(alias) {
    if (!alias || typeof alias !== 'object') {
      return undefined;
    }
    const up = !!alias.updownFan;
    const left = !!alias.leftrightFan;
    if (up && left) {
      return 'both';
    }
    if (up) {
      return 'vertical';
    }
    if (left) {
      return 'horizontal';
    }
    return 'off';
  }

  _normalizeReadValue(datapoint, value) {
    if (datapoint.type === 'boolean') {
      return normalizeBooleanValue(value);
    }

    if (datapoint.type === 'number') {
      if (value === null || value === undefined || value === '') {
        return null;
      }
      const parsed = Number(value);
      return Number.isNaN(parsed) ? null : parsed;
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
