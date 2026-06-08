<img src="admin/midea-serialbridge.svg" alt="Logo" width="120"/>
# ioBroker.midea-serialbridge

## midea-serialbridge adapter for ioBroker

This adapter allows you to control Midea HVAC units locally using the well known serial bridge interface. It is based on the logic of the [node-mideahvac](https://github.com/reneklootwijk/node-mideahvac) project and exposes all relevant datapoints to ioBroker. Cloud functionality has intentionally been left out so that the devices can be operated without an external connection.

For easier maintenance and to allow local modifications we ship a vendored copy of `node-mideahvac` with the adapter. The sources (including the MIT license) are located in [`lib/node-mideahvac`](lib/node-mideahvac).

## Features

- Connect to a TCP serial bridge (default port 23)
- Poll the device for specific datapoints at configurable intervals
- Write commands from ioBroker states back to the air conditioner
- Send raw JSON commands to the bridge for advanced control scenarios
- Automatic reconnects and error handling
- JSON based configuration UI
- Optional exposure of all raw status properties as read-only ioBroker states

## Prerequisites

- ioBroker host running js-controller 5.0.19 or newer
- Node.js 18 or newer
- A working Midea serial bridge that is reachable from the ioBroker host

## Configuration

Open the adapter configuration in the ioBroker Admin. Enter the IP address (or hostname) and port of your serial bridge on the **Connection** tab. The **Options** tab allows you to disable the audible confirmation beep, enable exposing raw status values and configure polling behaviour. You can enable or disable polling for each datapoint and configure custom intervals. If no custom interval is specified, the global interval is used. Enable the checkbox **Expose raw status datapoints** to automatically create read-only states for every property reported by the device (e.g. timers, lights or diagnostic flags). The additional states are created beneath the `statusRaw.*` channel and contain the raw values as delivered by the unit. If your bridge occasionally becomes unreachable you can enable **Restart adapter on connection errors** and specify the restart interval to automatically recover from prolonged outages without manual interaction.

### Unknown C1 group diagnosis mode

For protocol analysis you can enable **Enable unknown group diagnosis polling** on the **Options** tab. This mode is intentionally read-only: it sends only safe 20-byte C1 query frames in the known `41 21 01 <group> 00 ... 00` schema and does not send control, SetStatus or B0 property-set frames.

Configure **Unknown group IDs** as comma-separated hexadecimal group bytes from `0x40` to `0x4F`, for example `40,41,42,43,46,47,48,49`. The adapter ignores invalid values and duplicates, enforces a minimum interval of 10 seconds, limits the list to 8 groups, and polls the groups sequentially with a small pause so the device is not flooded.

Responses are written only below `statusRaw.unknownGroups.groupXX.*` for analysis and never create normal sensor datapoints. Each response includes only compact metadata: `rawFrameHex`, `payloadHex`, `responseId` and `groupByte`. Group byte `0x41` is now supported as `getGroup41Data`; if it is still configured here, the adapter skips it with a debug note instead of creating duplicate unknown-group states. Compare `payloadHex` while changing real-world conditions to identify frame-level differences.

### C1 Group 41 diagnostic candidate values

The regular polling configuration now includes `getGroup41Data`, a read-only 20-byte C1 query (`41 21 01 41 00 ... 00`) for experimentally decoded Group 41 diagnostic data. The decoded values are exposed as normal `sensors.*` datapoints, but their state names and descriptions deliberately contain `Kandidat` because the exact Midea protocol meaning can differ between devices and is not finally verified.

Group 41 currently decodes the direct byte 04 value as `sensors.compressorFrequencyCandidate` and applies the Midea temperature formula `(byte - 50) / 2` to bytes 08, 10, 11, 12 and 13 for the temperature candidates. When raw status output is enabled, compact Group 41 raw values are available as `statusRaw.group41_rawFrameHex` and `statusRaw.group41_payloadHex`.

The following datapoints are available out of the box:

| State ID                                | Description                                                                                 | Read | Write |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ---- | ----- |
| `power`                                 | Turn the unit on or off                                                                     | ✓    | ✓     |
| `mode`                                  | Operation mode (auto, cool, heat, dry, fan)                                                 | ✓    | ✓     |
| `targetTemperature`                     | Desired room temperature                                                                    | ✓    | ✓     |
| `indoorTemperature`                     | Current indoor temperature                                                                  | ✓    | ✗     |
| `outdoorTemperature`                    | Current outdoor temperature                                                                 | ✓    | ✗     |
| `totalEnergy`                           | Internal total energy counter from C1 group 4 (kWh)                                         | ✓    | ✗     |
| `compressorFrequencyCandidate`          | Candidate compressor frequency / inverter load stage from C1 Group 41 byte 04 (Hz)          | ✓    | ✗     |
| `hotGasOrCondenserTemperatureCandidate` | Candidate hot-gas, condenser or outdoor-unit pipe temperature from C1 Group 41 byte 08 (°C) | ✓    | ✗     |
| `evaporatorTemperature1Candidate`       | Candidate evaporator or pipe temperature 1 from C1 Group 41 byte 10 (°C)                    | ✓    | ✗     |
| `evaporatorTemperature2Candidate`       | Candidate evaporator or pipe temperature 2 from C1 Group 41 byte 11 (°C)                    | ✓    | ✗     |
| `outdoorCoilTemperatureCandidate`       | Candidate outdoor-unit, condenser or pipe temperature from C1 Group 41 byte 12 (°C)         | ✓    | ✗     |
| `outdoorAmbientTemperatureCandidate`    | Candidate outdoor temperature / outdoor sensor from C1 Group 41 byte 13 (°C)                | ✓    | ✗     |
| `fanSpeed`                              | Fan speed (auto, low, medium, high)                                                         | ✓    | ✓     |
| `swingMode`                             | Swing mode (off, vertical, horizontal, both)                                                | ✓    | ✓     |
| `ecoMode`                               | Eco mode                                                                                    | ✓    | ✓     |
| `turboMode`                             | Turbo / powerful mode                                                                       | ✓    | ✓     |
| `sleepMode`                             | Sleep mode                                                                                  | ✓    | ✓     |

Whenever you change a writable state in ioBroker the adapter forwards the command to the bridge immediately.

### JSON command input

For advanced use cases you can send arbitrary command payloads to the serial bridge through the state `control.command`. The state expects a JSON object string that is passed as-is to the bridge (with the adapter optionally adding `"beep": false` when the configuration disables beeps). Example:

```
{"beep": false, "temperatureSetpoint": 30}
```

When sending boolean properties you can pass the string value `"toggle"` to invert the cached state of supported flags (`power`, `ecoMode`, `frostProtectionMode`, `turboMode`, `sleepMode`). This allows commands such as:

```
{"turboMode": "toggle"}
```

Successful commands are acknowledged automatically and the resulting status update is reflected in the other datapoints.

## Known limitations

- Only local serial control is supported. Cloud features (OSK) are explicitly not part of this adapter.
- The adapter currently supports a single indoor unit per instance.

## Changelog

### 0.0.6

- Keep raw debug output compact by exposing only frame/payload hex values and removing byte/analog analysis states.

### 0.0.5

- Add regular `getGroup41Data` polling for experimental C1 Group 41 diagnostic candidate sensor values.

### 0.0.2

- Align admin JSON config layout sizes with adapter checker requirements.
- Add required license metadata type information.
- Remove deprecated metadata and release version 0.0.2.

### 0.0.1

- Initial release of the adapter.

See [CHANGELOG.md](CHANGELOG.md).

## 💙 Unterstützung

Ich bastle an diesem Adapter in meiner Freizeit.  
Wenn er dir gefällt oder dir weiterhilft, freue ich mich über eine kleine Spende:

[![Spenden via PayPal](https://img.shields.io/badge/Spenden-PayPal-blue.svg?logo=paypal)](https://www.paypal.com/paypalme/AuhuberD)

## License

[GPLv3](LICENSE)

Copyright (c) 2025 DosOrDie
