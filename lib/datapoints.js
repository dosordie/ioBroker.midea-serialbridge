'use strict';

/**
 * Definition of datapoints supported by the adapter.
 * Each datapoint contains metadata about the ioBroker state and the protocol mapping.
 */
const DATA_POINTS = [
  {
    id: 'power',
    channel: 'control',
    name: 'Power',
    role: 'switch.power',
    type: 'boolean',
    write: true,
    pollable: true,
  },
  {
    id: 'mode',
    channel: 'control',
    name: 'Mode',
    role: 'level.mode',
    type: 'number',
    write: true,
    states: {
      0: 'auto',
      1: 'cool',
      2: 'dry',
      3: 'heat',
      4: 'fan',
    },
    pollable: true,
  },
  {
    id: 'targetTemperature',
    channel: 'control',
    name: 'Target temperature',
    role: 'level.temperature',
    type: 'number',
    unit: '°C',
    min: 16,
    max: 31,
    step: 1,
    write: true,
    pollable: true,
  },
  {
    id: 'indoorTemperature',
    channel: 'sensors',
    name: 'Indoor temperature',
    role: 'value.temperature',
    type: 'number',
    unit: '°C',
    readOnly: true,
    pollable: true,
  },
  {
    id: 'outdoorTemperature',
    channel: 'sensors',
    name: 'Outdoor temperature',
    role: 'value.temperature',
    type: 'number',
    unit: '°C',
    readOnly: true,
    pollable: true,
  },
  {
    id: 'fanSpeed',
    channel: 'control',
    name: 'Fan speed',
    role: 'level.speed',
    type: 'number',
    write: true,
    states: {
      0: 'auto',
      1: 'low',
      2: 'medium',
      3: 'high',
      4: 'turbo',
    },
    pollable: true,
  },
  {
    id: 'swingMode',
    channel: 'control',
    name: 'Swing mode',
    role: 'level.swing',
    type: 'number',
    write: true,
    states: {
      0: 'off',
      1: 'vertical',
      2: 'horizontal',
      3: 'both',
    },
    pollable: true,
  },
  {
    id: 'ecoMode',
    channel: 'control',
    name: 'Eco mode',
    role: 'switch.eco',
    type: 'boolean',
    write: true,
    pollable: true,
  },
  {
    id: 'turboMode',
    channel: 'control',
    name: 'Turbo mode',
    role: 'switch.boost',
    type: 'boolean',
    write: true,
    pollable: true,
  },
  {
    id: 'sleepMode',
    channel: 'control',
    name: 'Sleep mode',
    role: 'switch.sleep',
    type: 'boolean',
    write: true,
    pollable: true,
  },
];

module.exports = {
  DATA_POINTS,
};

