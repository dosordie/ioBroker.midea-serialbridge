'use strict';

const EventEmitter = require('events');
const { createAppliance } = require('node-mideahvac');

const LEGACY_MODE_NUMBERS = {
  0: 'auto',
  1: 'cool',
  2: 'dry',
  3: 'heat',
  4: 'fanonly',
  5: 'customdry',
};

const MODE_VALUE_TO_NAME = {
  1: 'auto',
  2: 'cool',
  3: 'dry',
  4: 'heat',
  5: 'fanonly',
  6: 'customdry',
};

const MODE_ALIASES = {
  auto: 'auto',
  cool: 'cool',
  dry: 'dry',
  heat: 'heat',
  fan: 'fanonly',
  fanonly: 'fanonly',
  'fan only': 'fanonly',
  customdry: 'customdry',
  'custom dry': 'customdry',
};

const FAN_SPEED_ALIASES = {
  auto: 'auto',
  silent: 'silent',
  low: 'low',
  medium: 'medium',
  high: 'high',
};

const SWING_ALIASES = {
  off: { updownFan: false, leftrightFan: false },
  none: { updownFan: false, leftrightFan: false },
  vertical: { updownFan: true, leftrightFan: false },
  horizontal: { updownFan: false, leftrightFan: true },
  both: { updownFan: true, leftrightFan: true },
};

function normalizeString(value) {
  if (value == null) {
    return '';
  }
  return String(value).trim().toLowerCase();
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
      if (normalized) {
        mapped.mode = normalized;
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
      if (normalized) {
        mapped.fanSpeed = normalized;
      }
    }

    if (status.updownFan !== undefined || status.leftrightFan !== undefined) {
      const up =
        status.updownFan === undefined
          ? ['vertical', 'both'].includes(this.statusCache.swingMode)
          : !!status.updownFan;
      const left =
        status.leftrightFan === undefined
          ? ['horizontal', 'both'].includes(this.statusCache.swingMode)
          : !!status.leftrightFan;
      mapped.swingMode = this._encodeSwingMode(up, left);
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

    return mapped;
  }

  _normalizeModeFromStatus(value) {
    if (value == null) {
      return undefined;
    }

    if (typeof value === 'object') {
      if (typeof value.description === 'string') {
        const normalized = normalizeString(value.description);
        return MODE_ALIASES[normalized] || normalized;
      }
      if (typeof value.value === 'number') {
        const mapped = MODE_VALUE_TO_NAME[value.value] || LEGACY_MODE_NUMBERS[value.value];
        if (mapped) {
          return mapped;
        }
      }
    }

    if (typeof value === 'number') {
      const mapped = MODE_VALUE_TO_NAME[value] || LEGACY_MODE_NUMBERS[value];
      if (mapped) {
        return mapped;
      }
      return undefined;
    }

    const normalized = normalizeString(value);
    return MODE_ALIASES[normalized] || normalized;
  }

  _normalizeFanSpeedFromStatus(value) {
    if (value == null) {
      return undefined;
    }

    if (typeof value === 'object') {
      if (typeof value.description === 'string') {
        return normalizeString(value.description);
      }
      if (typeof value.value === 'number') {
        value = value.value;
      }
    }

    if (typeof value === 'number') {
      if (value >= 101) {
        return value === 101 ? 'fixed' : 'auto';
      }
      if (value <= 20) {
        return 'silent';
      }
      if (value <= 40) {
        return 'low';
      }
      if (value <= 60) {
        return 'medium';
      }
      return 'high';
    }

    const normalized = normalizeString(value);
    if (normalized === 'fixed') {
      return 'fixed';
    }
    return FAN_SPEED_ALIASES[normalized] || normalized;
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
        return { powerOn: value === 'true' || value === true || value === 1 };

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
        return { ecoMode: value === 'true' || value === true || value === 1 };

      case 'turboMode':
        return { turboMode: value === 'true' || value === true || value === 1 };

      case 'sleepMode':
        return { sleepMode: value === 'true' || value === true || value === 1 };

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
      case 'mode':
        return this._convertModeValue(value);
      case 'fanSpeed':
        return this._convertFanSpeedValue(value);
      case 'swingMode': {
        const swing = this._convertSwingValue(value);
        if (!swing) {
          return undefined;
        }
        return this._encodeSwingMode(!!swing.updownFan, !!swing.leftrightFan);
      }
      case 'power':
      case 'ecoMode':
      case 'turboMode':
      case 'sleepMode':
        return value === 'true' || value === true || value === 1;
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
      if (value >= 0 && value <= 4) {
        return ['auto', 'silent', 'low', 'medium', 'high'][value];
      }
      if (value >= 0 && value <= 100) {
        return value;
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
    if (!Number.isNaN(numeric) && numeric >= 0 && numeric <= 100) {
      return numeric;
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
