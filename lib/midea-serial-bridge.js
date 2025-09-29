'use strict';

const EventEmitter = require('events');
const { createAppliance } = require('node-mideahvac');
const {
  LEGACY_MODE_NUMBERS,
  MODE_VALUE_TO_NAME,
  MODE_ALIASES,
  MODE_NAME_TO_VALUE,
  MODE_NAME_TO_LEGACY_VALUE,
  FAN_SPEED_ALIASES,
  FAN_SPEED_NAME_TO_VALUE,
  FAN_SPEED_VALUE_TO_NAME,
  SWING_ALIASES,
  SWING_NAME_TO_VALUE,
  SWING_VALUE_TO_NAME,
  normalizeString,
} = require('./value-mappings');

function toBoolean(value) {
  return value === true || value === 1 || value === 'true';
}

class MideaSerialBridge extends EventEmitter {
  constructor(options) {
    super();

    this.host = options.host;
    this.port = options.port || 23;
    this.log = options.log;
    this.beepOnCommand = options.beepOnCommand !== false;

    this.device = null;
    this.connected = false;
    this.statusCache = {};
    this.capabilitiesCache = null;
    const representation = options.valueRepresentation || {};
    this.valueRepresentation = {
      mode: !!representation.mode,
      fanSpeed: !!representation.fanSpeed,
      swingMode: !!representation.swingMode,
    };
  }

  async connect() {
    if (this.device) {
      return;
    }

    this.device = createAppliance({
      communicationMethod: 'serialbridge',
      host: this.host,
      port: this.port,
    });

    this._bindDeviceEvents();

    try {
      const result = await this.device.initialize();
      this.connected = true;
      if (result && result.status) {
        this._handleStatus(result.status);
      }
      if (result && result.capabilities) {
        this.capabilitiesCache = result.capabilities;
        this.emit('capabilities', result.capabilities);
      }
    } catch (error) {
      this.log.error(`Failed to initialize serial bridge: ${error.message}`);
      await this.disconnect().catch(() => {});
      throw error;
    }
  }

  async disconnect() {
    if (!this.device) {
      return;
    }

    if (this.device.removeAllListeners) {
      this.device.removeAllListeners('connected');
      this.device.removeAllListeners('disconnected');
      this.device.removeAllListeners('status-update');
    }

    if (this.device._connection && typeof this.device._connection.destroy === 'function') {
      try {
        this.device._connection.destroy();
      } catch (error) {
        this.log.debug(`Failed to destroy serial bridge connection: ${error.message}`);
      }
    }

    this.device = null;
    this.connected = false;
  }

  async getStatus() {
    if (!this.device) {
      throw new Error('Bridge not connected');
    }

    const status = await this.device.getStatus();
    return this._handleStatus(status);
  }

  async getCapabilities() {
    if (!this.device) {
      throw new Error('Bridge not connected');
    }

    const capabilities = await this.device.getCapabilities();
    this.capabilitiesCache = capabilities;
    this.emit('capabilities', capabilities);
    return capabilities;
  }

  async getPowerUsage() {
    if (!this.device) {
      throw new Error('Bridge not connected');
    }

    const usage = await this.device.getPowerUsage();
    if (usage && typeof usage === 'object') {
      this.emit('powerUsage', usage);
    }
    return usage;
  }

  async set(datapointId, value) {
    if (!this.device) {
      throw new Error('Bridge not connected');
    }

    const payload = this._buildSetPayload(datapointId, value);
    if (!payload || Object.keys(payload).length === 0) {
      throw new Error(`Unsupported datapoint ${datapointId}`);
    }

    const status = await this.device.setStatus(this._applyBeepPreference(payload));
    const mapped = this._handleStatus(status);

    if (!mapped || mapped[datapointId] === undefined) {
      const fallback = this._fallbackValue(datapointId, value);
      if (fallback !== undefined) {
        mapped[datapointId] = fallback;
        this.statusCache[datapointId] = fallback;
      }
    }

    return mapped;
  }

  async sendCommand(command) {
    if (!this.device) {
      throw new Error('Bridge not connected');
    }

    if (!command || typeof command !== 'object' || Array.isArray(command)) {
      throw new Error('Command payload must be an object');
    }

    const payload = this._applyBeepPreference({ ...command });
    const status = await this.device.setStatus(payload);
    return this._handleStatus(status);
  }

  _bindDeviceEvents() {
    this.device.on('connected', () => {
      this.connected = true;
      this.emit('connected');
    });

    this.device.on('disconnected', () => {
      this.connected = false;
      this.emit('disconnected');
    });

    this.device.on('status-update', (status) => {
      this._handleStatus(status);
    });
  }

  _handleStatus(status) {
    if (!status || typeof status !== 'object') {
      return {};
    }

    const mapped = this._mapStatus(status);
    if (Object.keys(mapped).length > 0) {
      for (const [key, val] of Object.entries(mapped)) {
        this.statusCache[key] = val;
      }
      this.emit('statusData', mapped, status);
    }
    return mapped;
  }

  _mapStatus(status) {
    const mapped = {};

    if (status.powerOn !== undefined) {
      mapped.power = !!status.powerOn;
    }

    if (status.mode !== undefined) {
      const normalized = this._normalizeModeFromStatus(status.mode);
      const formatted = this._formatModeValue(normalized);
      if (formatted !== undefined) {
        mapped.mode = formatted;
      }
    }

    if (status.temperatureSetpoint !== undefined) {
      const parsed = Number(status.temperatureSetpoint);
      if (!Number.isNaN(parsed)) {
        mapped.targetTemperature = parsed;
      }
    }

    if (status.indoorTemperature !== undefined && status.indoorTemperature !== null) {
      const parsed = Number(status.indoorTemperature);
      if (!Number.isNaN(parsed)) {
        mapped.indoorTemperature = parsed;
      }
    }

    if (status.outdoorTemperature !== undefined && status.outdoorTemperature !== null) {
      const parsed = Number(status.outdoorTemperature);
      if (!Number.isNaN(parsed)) {
        mapped.outdoorTemperature = parsed;
      }
    }

    if (status.fanSpeed !== undefined) {
      const normalized = this._normalizeFanSpeedFromStatus(status.fanSpeed);
      const formatted = this._formatFanSpeedValue(normalized);
      if (formatted !== undefined) {
        mapped.fanSpeed = formatted;
      }
    }

    if (status.updownFan !== undefined || status.leftrightFan !== undefined) {
      const cachedSwing = this._resolveSwingValue(this.statusCache.swingMode);
      const cachedSwingName = this._selectSwingString(cachedSwing) || 'off';
      const up =
        status.updownFan === undefined
          ? ['vertical', 'both'].includes(cachedSwingName)
          : !!status.updownFan;
      const left =
        status.leftrightFan === undefined
          ? ['horizontal', 'both'].includes(cachedSwingName)
          : !!status.leftrightFan;
      const normalized = this._normalizeSwingFromFlags(up, left);
      const formatted = this._formatSwingValue(normalized);
      if (formatted !== undefined) {
        mapped.swingMode = formatted;
      }
    }

    if (status.ecoMode !== undefined) {
      mapped.ecoMode = !!status.ecoMode;
    }

    if (status.turboMode !== undefined) {
      mapped.turboMode = !!status.turboMode;
    }

    if (status.sleepMode !== undefined) {
      mapped.sleepMode = !!status.sleepMode;
    }

    if (status.statusCode !== undefined) {
      const normalizedStatusCode = this._normalizeStatusCode(status.statusCode);
      if (normalizedStatusCode) {
        mapped.statusCode = normalizedStatusCode;
      }
    }

    return mapped;
  }

  _normalizeModeFromStatus(value) {
    if (value == null) {
      return undefined;
    }

    let numericValue;
    let nameValue;

    if (typeof value === 'object') {
      if (typeof value.value === 'number' && Number.isFinite(value.value)) {
        numericValue = Number(value.value);
      }
      if (typeof value.description === 'string') {
        nameValue = this._normalizeModeName(value.description);
      }
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      numericValue = Number(value);
    } else {
      nameValue = this._normalizeModeName(value);
    }

    if (nameValue === undefined && numericValue !== undefined) {
      nameValue = this._modeNumberToName(numericValue);
    }

    if (numericValue === undefined && nameValue !== undefined) {
      numericValue = this._modeNameToNumeric(nameValue);
    }

    if (nameValue === undefined && numericValue === undefined) {
      return undefined;
    }

    return { name: nameValue, numeric: numericValue };
  }

  _normalizeFanSpeedFromStatus(value) {
    if (value == null) {
      return undefined;
    }

    let rawNumeric;
    let nameValue;

    if (typeof value === 'object') {
      if (typeof value.value === 'number' && Number.isFinite(value.value)) {
        rawNumeric = Number(value.value);
      }
      if (typeof value.description === 'string') {
        nameValue = this._normalizeFanSpeedName(value.description);
      }
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      rawNumeric = Number(value);
    } else {
      nameValue = this._normalizeFanSpeedName(value);
    }

    const numericValue = this._fanSpeedRawToNumeric(rawNumeric, nameValue);
    const resolvedName = nameValue || this._fanSpeedNumericToName(numericValue);

    if (numericValue === undefined && resolvedName === undefined) {
      return undefined;
    }

    return { name: resolvedName, numeric: numericValue };
  }

  _formatModeValue(normalized) {
    if (!normalized) {
      return undefined;
    }

    if (this._shouldUseNumericValue('mode')) {
      const numeric = this._selectModeNumeric(normalized);
      if (numeric !== undefined) {
        return numeric;
      }
      const fallback = this._selectModeString(normalized);
      return fallback !== undefined ? this._modeNameToNumeric(fallback) : undefined;
    }

    return this._selectModeString(normalized);
  }

  _selectModeNumeric(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return Number(normalized.numeric);
    }
    if (normalized.name) {
      const mapped = this._modeNameToNumeric(normalized.name);
      if (mapped !== undefined) {
        return mapped;
      }
    }
    return undefined;
  }

  _selectModeString(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.name) {
      return normalized.name;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return this._modeNumberToName(normalized.numeric);
    }
    return undefined;
  }

  _normalizeModeName(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    if (MODE_ALIASES[normalized]) {
      return MODE_ALIASES[normalized];
    }
    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      const mapped = this._modeNumberToName(numeric);
      if (mapped) {
        return mapped;
      }
    }
    if (
      MODE_NAME_TO_VALUE[normalized] !== undefined ||
      MODE_NAME_TO_LEGACY_VALUE[normalized] !== undefined
    ) {
      return normalized;
    }
    return undefined;
  }

  _modeNumberToName(value) {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    const numeric = Number(value);
    return MODE_VALUE_TO_NAME[numeric] || LEGACY_MODE_NUMBERS[numeric];
  }

  _modeNameToNumeric(name) {
    if (!name) {
      return undefined;
    }
    if (MODE_NAME_TO_VALUE[name] !== undefined) {
      return MODE_NAME_TO_VALUE[name];
    }
    if (MODE_NAME_TO_LEGACY_VALUE[name] !== undefined) {
      return MODE_NAME_TO_LEGACY_VALUE[name];
    }
    return undefined;
  }

  _formatFanSpeedValue(normalized) {
    if (!normalized) {
      return undefined;
    }

    if (this._shouldUseNumericValue('fanSpeed')) {
      const numeric = this._selectFanSpeedNumeric(normalized);
      if (numeric !== undefined) {
        return numeric;
      }
      const fallback = this._selectFanSpeedString(normalized);
      return fallback !== undefined ? this._fanSpeedNameToNumeric(fallback) : undefined;
    }

    return this._selectFanSpeedString(normalized);
  }

  _selectFanSpeedNumeric(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return Number(normalized.numeric);
    }
    if (normalized.name) {
      const mapped = this._fanSpeedNameToNumeric(normalized.name);
      if (mapped !== undefined) {
        return mapped;
      }
    }
    return undefined;
  }

  _selectFanSpeedString(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.name) {
      return normalized.name;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return this._fanSpeedNumericToName(normalized.numeric);
    }
    return undefined;
  }

  _normalizeFanSpeedName(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    if (FAN_SPEED_ALIASES[normalized]) {
      return FAN_SPEED_ALIASES[normalized];
    }
    if (FAN_SPEED_NAME_TO_VALUE[normalized] !== undefined) {
      return normalized;
    }
    return undefined;
  }

  _fanSpeedRawToNumeric(raw, name) {
    if (Number.isFinite(raw)) {
      const numeric = Number(raw);
      if (numeric >= 0 && numeric <= 5 && Number.isInteger(numeric)) {
        const mapped = FAN_SPEED_VALUE_TO_NAME[numeric];
        if (mapped) {
          return FAN_SPEED_NAME_TO_VALUE[mapped];
        }
      }
      if (numeric >= 101) {
        return numeric === 101 ? FAN_SPEED_NAME_TO_VALUE.fixed : FAN_SPEED_NAME_TO_VALUE.auto;
      }
      if (numeric <= 20) {
        return FAN_SPEED_NAME_TO_VALUE.silent;
      }
      if (numeric <= 40) {
        return FAN_SPEED_NAME_TO_VALUE.low;
      }
      if (numeric <= 60) {
        return FAN_SPEED_NAME_TO_VALUE.medium;
      }
      if (numeric <= 100) {
        return FAN_SPEED_NAME_TO_VALUE.high;
      }
    }

    if (name && FAN_SPEED_NAME_TO_VALUE[name] !== undefined) {
      return FAN_SPEED_NAME_TO_VALUE[name];
    }

    return undefined;
  }

  _fanSpeedNumericToName(value) {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return FAN_SPEED_VALUE_TO_NAME[Number(value)];
  }

  _fanSpeedNameToNumeric(name) {
    if (!name) {
      return undefined;
    }
    return FAN_SPEED_NAME_TO_VALUE[name];
  }

  _normalizeSwingFromFlags(up, left) {
    const name = this._encodeSwingMode(up, left);
    const numeric = SWING_NAME_TO_VALUE[name];
    return { name, numeric };
  }

  _formatSwingValue(normalized) {
    if (!normalized) {
      return undefined;
    }

    if (this._shouldUseNumericValue('swingMode')) {
      const numeric = this._selectSwingNumeric(normalized);
      if (numeric !== undefined) {
        return numeric;
      }
      const fallback = this._selectSwingString(normalized);
      return fallback !== undefined ? SWING_NAME_TO_VALUE[fallback] : undefined;
    }

    return this._selectSwingString(normalized);
  }

  _resolveSwingValue(value) {
    return this._normalizeSwingValue(value) || {};
  }

  _normalizeSwingValue(value) {
    if (value == null) {
      return undefined;
    }

    if (
      typeof value === 'object' &&
      value.updownFan !== undefined &&
      value.leftrightFan !== undefined
    ) {
      const up = !!value.updownFan;
      const left = !!value.leftrightFan;
      return this._normalizeSwingFromFlags(up, left);
    }

    if (typeof value === 'number' && Number.isFinite(value)) {
      const name = this._swingNumericToName(value);
      if (name !== undefined) {
        return { name, numeric: Number(value) };
      }
      return undefined;
    }

    const name = this._normalizeSwingName(value);
    if (name) {
      return { name, numeric: SWING_NAME_TO_VALUE[name] };
    }

    return undefined;
  }

  _normalizeSwingName(value) {
    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }
    if (SWING_ALIASES[normalized]) {
      const alias = SWING_ALIASES[normalized];
      return this._encodeSwingMode(!!alias.updownFan, !!alias.leftrightFan);
    }
    if (SWING_NAME_TO_VALUE[normalized] !== undefined) {
      return normalized;
    }
    return undefined;
  }

  _selectSwingString(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.name) {
      return normalized.name;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return this._swingNumericToName(normalized.numeric);
    }
    return undefined;
  }

  _selectSwingNumeric(normalized) {
    if (!normalized) {
      return undefined;
    }
    if (normalized.numeric !== undefined && Number.isFinite(normalized.numeric)) {
      return Number(normalized.numeric);
    }
    if (normalized.name && SWING_NAME_TO_VALUE[normalized.name] !== undefined) {
      return SWING_NAME_TO_VALUE[normalized.name];
    }
    return undefined;
  }

  _swingNumericToName(value) {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    return SWING_VALUE_TO_NAME[Number(value)];
  }

  _normalizeStatusCode(value) {
    if (value == null) {
      return undefined;
    }

    if (typeof value === 'object') {
      const result = {};
      if (typeof value.value === 'number' && Number.isFinite(value.value)) {
        result.value = Number(value.value);
      }
      if (typeof value.description === 'string' && value.description.trim()) {
        result.description = value.description;
      }
      return Object.keys(result).length > 0 ? result : undefined;
    }

    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return { value: numeric };
    }

    return undefined;
  }

  _shouldUseNumericValue(datapointId) {
    return !!(this.valueRepresentation && this.valueRepresentation[datapointId]);
  }

  _encodeSwingMode(up, left) {
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

  _buildSetPayload(datapointId, value) {
    switch (datapointId) {
      case 'power':
        return { powerOn: toBoolean(value) };

      case 'mode': {
        const mode = this._convertModeValue(value);
        return mode ? { mode } : {};
      }

      case 'targetTemperature': {
        const numeric = Number(value);
        if (Number.isNaN(numeric)) {
          throw new Error(`Invalid temperature value ${value}`);
        }
        return { temperatureSetpoint: numeric };
      }

      case 'fanSpeed': {
        const fanSpeed = this._convertFanSpeedValue(value);
        return fanSpeed ? { fanSpeed } : {};
      }

      case 'swingMode': {
        const swing = this._convertSwingValue(value);
        return swing;
      }

      case 'ecoMode':
        return { ecoMode: toBoolean(value) };

      case 'turboMode':
        return { turboMode: toBoolean(value) };

      case 'sleepMode':
        return { sleepMode: toBoolean(value) };

      default:
        return {};
    }
  }

  _applyBeepPreference(payload) {
    if (!payload || typeof payload !== 'object') {
      return payload;
    }

    if (this.beepOnCommand === false && payload.beep === undefined) {
      return { ...payload, beep: false };
    }

    return payload;
  }

  _fallbackValue(datapointId, value) {
    switch (datapointId) {
      case 'mode': {
        const normalized = this._normalizeModeFromStatus(value);
        return this._formatModeValue(normalized);
      }
      case 'fanSpeed': {
        const normalized = this._normalizeFanSpeedFromStatus(value);
        return this._formatFanSpeedValue(normalized);
      }
      case 'swingMode': {
        const normalized = this._normalizeSwingValue(value);
        return this._formatSwingValue(normalized);
      }
      case 'power':
      case 'ecoMode':
      case 'turboMode':
      case 'sleepMode':
        return toBoolean(value);
      case 'targetTemperature': {
        const numeric = Number(value);
        return Number.isNaN(numeric) ? undefined : numeric;
      }
      default:
        return undefined;
    }
  }

  _convertModeValue(value) {
    if (typeof value === 'number') {
      const mapped = MODE_VALUE_TO_NAME[value] || LEGACY_MODE_NUMBERS[value];
      if (mapped) {
        return mapped;
      }
    }

    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }

    if (MODE_ALIASES[normalized]) {
      return MODE_ALIASES[normalized];
    }

    if (MODE_VALUE_TO_NAME[Number(normalized)]) {
      return MODE_VALUE_TO_NAME[Number(normalized)];
    }

    throw new Error(`Unsupported mode value ${value}`);
  }

  _convertFanSpeedValue(value) {
    if (typeof value === 'number') {
      if (value >= 0 && value <= 5 && Number.isInteger(value)) {
        const mapped = FAN_SPEED_VALUE_TO_NAME[value];
        if (mapped) {
          return mapped;
        }
      }
      if (value >= 0 && value <= 100) {
        return value;
      }
      if (value === 101) {
        return 'fixed';
      }
      if (value > 100) {
        return 'auto';
      }
    }

    const normalized = normalizeString(value);
    if (!normalized) {
      return undefined;
    }

    if (FAN_SPEED_ALIASES[normalized]) {
      return FAN_SPEED_ALIASES[normalized];
    }

    const numeric = Number(normalized);
    if (!Number.isNaN(numeric)) {
      if (numeric >= 0 && numeric <= 5 && Number.isInteger(numeric)) {
        const mapped = FAN_SPEED_VALUE_TO_NAME[numeric];
        if (mapped) {
          return mapped;
        }
      }
      if (numeric >= 0 && numeric <= 100) {
        return numeric;
      }
      if (numeric === 101) {
        return 'fixed';
      }
      if (numeric > 100) {
        return 'auto';
      }
    }

    throw new Error(`Unsupported fan speed value ${value}`);
  }

  _convertSwingValue(value) {
    if (typeof value === 'number') {
      switch (value) {
        case 0:
          return { updownFan: false, leftrightFan: false };
        case 1:
          return { updownFan: true, leftrightFan: false };
        case 2:
          return { updownFan: false, leftrightFan: true };
        case 3:
          return { updownFan: true, leftrightFan: true };
        default:
          throw new Error(`Unsupported swing mode value ${value}`);
      }
    }

    const normalized = normalizeString(value);
    if (!normalized) {
      return { updownFan: false, leftrightFan: false };
    }

    if (SWING_ALIASES[normalized]) {
      return { ...SWING_ALIASES[normalized] };
    }

    throw new Error(`Unsupported swing mode value ${value}`);
  }
}

module.exports = {
  MideaSerialBridge,
};
