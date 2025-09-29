'use strict';

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

const MODE_NAME_TO_VALUE = {
  auto: 1,
  cool: 2,
  dry: 3,
  heat: 4,
  fanonly: 5,
  customdry: 6,
};

const MODE_NAME_TO_LEGACY_VALUE = {
  auto: 0,
  cool: 1,
  dry: 2,
  heat: 3,
  fanonly: 4,
  customdry: 5,
};

const FAN_SPEED_ALIASES = {
  auto: 'auto',
  silent: 'silent',
  low: 'low',
  medium: 'medium',
  high: 'high',
  fixed: 'fixed',
};

const FAN_SPEED_NAME_TO_VALUE = {
  auto: 102,
  silent: 20,
  low: 40,
  medium: 60,
  high: 80,
  fixed: 101,
};

const FAN_SPEED_VALUE_TO_NAME = {
  0: 'auto',
  1: 'silent',
  2: 'low',
  3: 'medium',
  4: 'high',
  5: 'fixed',
  20: 'silent',
  40: 'low',
  60: 'medium',
  80: 'high',
  101: 'fixed',
  102: 'auto',
};

const SWING_ALIASES = {
  off: { updownFan: false, leftrightFan: false },
  none: { updownFan: false, leftrightFan: false },
  vertical: { updownFan: true, leftrightFan: false },
  horizontal: { updownFan: false, leftrightFan: true },
  both: { updownFan: true, leftrightFan: true },
};

const SWING_NAME_TO_VALUE = {
  off: 0,
  vertical: 1,
  horizontal: 2,
  both: 3,
};

const SWING_VALUE_TO_NAME = {
  0: 'off',
  1: 'vertical',
  2: 'horizontal',
  3: 'both',
};

function normalizeString(value) {
  if (value == null) {
    return '';
  }
  return String(value).trim().toLowerCase();
}

module.exports = {
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
};
