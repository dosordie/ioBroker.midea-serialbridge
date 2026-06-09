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

Open the adapter configuration in the ioBroker Admin. Enter the IP address (or hostname) and port of your serial bridge on the **Connection** tab. The **Options** tab allows you to disable the audible confirmation beep, enable exposing raw status values and configure polling behaviour. The legacy switch **Enable custom polling per command** / **Individuelle Abfrage je Befehl aktivieren** is no longer shown and is ignored for compatibility with older configurations. The table of cyclic requests is always authoritative: enable or disable each request there and configure its individual interval. Missing table entries are restored with safe defaults during adapter startup. Enable the checkbox **Expose raw status datapoints** to automatically create read-only states for every property reported by the device (e.g. timers, lights or diagnostic flags). The additional states are created beneath the `statusRaw.*` channel and contain the raw values as delivered by the unit. If your bridge occasionally becomes unreachable you can enable **Restart adapter on connection errors** and specify the restart interval to automatically recover from prolonged outages without manual interaction.

The cyclic request table contains these regular polling requests:

| Request | Protocol response | Default |
| ------- | ----------------- | ------- |
| Status request / Statusabfrage | C0 | enabled, 60 s |
| Capabilities / Fähigkeiten | B5 | disabled, 3600 s |
| Energy counter / Energiezähler | C1 Group 44 | disabled, 300 s |
| Group 5 data / Group-5-Daten | C1 Group 45 | disabled, 300 s |
| Group 41 diagnostic data / Group-41-Diagnosedaten | C1 Group 41 | disabled, 60 s |

### Unknown C1 group diagnosis mode

For protocol analysis you can enable **Enable unknown group diagnosis polling** on the **Options** tab. This mode is intentionally read-only: it sends only safe 20-byte C1 query frames in the known `41 21 01 <group> 00 ... 00` schema and does not send control, SetStatus or B0 property-set frames.

Configure **Unknown group IDs** as comma-separated hexadecimal group bytes from `0x20` to `0x7F`, for example `20,21,30,31,50,51,60,7F`. The adapter ignores invalid values and duplicates, enforces a minimum interval of 10 seconds, limits the list to 16 groups, and polls the groups sequentially with a small pause so the device is not flooded. Regularly supported groups (`0x41` / `getGroup41Data`, `0x44` / power usage, `0x45` / Group 5 data) are skipped in this mode with a debug note.

Responses are written only below `statusRaw.unknownGroups.groupXX.*` for analysis and never create normal sensor datapoints. Each response includes only compact raw hex states: `rawFrameHex` and `payloadHex`. The mode intentionally does not create `rawByteXX`, `rawByteXXBits` or `analogCandidates` mass states. Compare `payloadHex` while changing real-world conditions to identify frame-level differences.

### C1 Group 41 diagnostic data

The regular polling configuration includes `getGroup41Data`, a read-only 20-byte C1 query (`41 21 01 41 00 ... 00`) for Group 41 diagnostic data. The decoded values are exposed as normal `sensors.*` datapoints. Some Group 41 values are still experimental and can differ between Midea devices, so uncertain values keep `Candidate` / `Kandidat` in their state IDs, names and descriptions.

Group 41 currently exposes the confirmed compressor frequency, indoor pipe temperature, indoor heat exchanger temperature and Group 41 outdoor temperature. Byte 08 remains unclear and is therefore exposed neutrally as a raw value plus one temperature candidate. Byte 12 remains a candidate for an outdoor-unit / condenser / heat-exchanger temperature. Byte 10 and byte 11 use the `raw - 50` scaling found in newer logs; byte 08, byte 12 and byte 13 use `(byte - 50) / 2` for the temperature values. When raw status output is enabled, compact Group 41 raw values remain available as `statusRaw.group41_rawFrameHex` and `statusRaw.group41_payloadHex`.

The following datapoints are available out of the box:

| State ID                                   | Description                                                                                   | Read | Write |
| ------------------------------------------ | --------------------------------------------------------------------------------------------- | ---- | ----- |
| `power`                                    | Turn the unit on or off                                                                       | ✓    | ✓     |
| `mode`                                     | Operation mode (auto, cool, heat, dry, fan)                                                   | ✓    | ✓     |
| `targetTemperature`                        | Desired room temperature                                                                      | ✓    | ✓     |
| `indoorTemperature`                        | Current indoor temperature                                                                    | ✓    | ✗     |
| `outdoorTemperature`                       | Current outdoor temperature                                                                   | ✓    | ✗     |
| `totalEnergy`                              | Internal total energy counter from C1 group 4 (kWh)                                           | ✓    | ✗     |
| `compressorFrequency`                      | Compressor frequency from C1 Group 41 byte 04 (Hz)                                            | ✓    | ✗     |
| `group41Byte08Raw`                         | Neutral raw value from C1 Group 41 byte 08                                                    | ✓    | ✗     |
| `group41Byte08TemperatureCandidate`        | Candidate unknown temperature value from C1 Group 41 byte 08 using `(raw - 50) / 2` (°C)      | ✓    | ✗     |
| `indoorPipeTemperature`                    | Indoor pipe / air temperature from C1 Group 41 byte 10 (°C)                                   | ✓    | ✗     |
| `indoorHeatExchangerTemperature`           | Indoor heat exchanger / pipe temperature from C1 Group 41 byte 11 (°C)                        | ✓    | ✗     |
| `outdoorHeatExchangerTemperatureCandidate` | Candidate outdoor-unit, condenser or heat exchanger temperature from C1 Group 41 byte 12 (°C) | ✓    | ✗     |
| `outdoorTemperatureGroup41`                | Outdoor temperature from C1 Group 41 byte 13 (°C)                                             | ✓    | ✗     |
| `fanSpeed`                                 | Fan speed (auto, low, medium, high)                                                           | ✓    | ✓     |
| `swingMode`                                | Swing mode (off, vertical, horizontal, both)                                                  | ✓    | ✓     |
| `ecoMode`                                  | Eco mode                                                                                      | ✓    | ✓     |
| `turboMode`                                | Turbo / powerful mode                                                                         | ✓    | ✓     |
| `sleepMode`                                | Sleep mode                                                                                    | ✓    | ✓     |

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

### 0.0.10

- Clean up the Admin polling configuration, remove the legacy custom-polling switch, normalize polling request defaults and align request labels.

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
