<img src="admin/midea-serialbridge.svg" alt="Logo" width="120"/>
# ioBroker.midea-serialbridge


## midea-serialbridge adapter for ioBroker

This adapter allows you to control Midea HVAC units locally using the well known serial bridge interface. It is based on the logic of the [node-mideahvac](https://github.com/reneklootwijk/node-mideahvac) project and exposes all relevant datapoints to ioBroker. Cloud functionality has intentionally been left out so that the devices can be operated without an external connection.

For easier maintenance and to allow local modifications we ship a vendored copy of `node-mideahvac` with the adapter. The sources (including the MIT license) are located in [`lib/node-mideahvac`](lib/node-mideahvac).

## Features

* Connect to a TCP serial bridge (default port 23)
* Poll the device for specific datapoints at configurable intervals
* Write commands from ioBroker states back to the air conditioner
* Send raw JSON commands to the bridge for advanced control scenarios
* Automatic reconnects and error handling
* JSON based configuration UI
* Optional exposure of all raw status properties as read-only ioBroker states

## Prerequisites

* ioBroker host running js-controller 5.0.19 or newer
* Node.js 18 or newer
* A working Midea serial bridge that is reachable from the ioBroker host

## Configuration

Open the adapter configuration in the ioBroker Admin. Enter the IP address (or hostname) and port of your serial bridge on the **Connection** tab. The **Options** tab allows you to disable the audible confirmation beep, enable exposing raw status values and configure polling behaviour. You can enable or disable polling for each datapoint and configure custom intervals. If no custom interval is specified, the global interval is used. Enable the checkbox **Expose raw status datapoints** to automatically create read-only states for every property reported by the device (e.g. timers, lights or diagnostic flags). The additional states are created beneath the `statusRaw.*` channel and contain the raw values as delivered by the unit. If your bridge occasionally becomes unreachable you can enable **Restart adapter on connection errors** and specify the restart interval to automatically recover from prolonged outages without manual interaction.

The following datapoints are available out of the box:

| State ID | Description | Read | Write |
| --- | --- | --- | --- |
| `power` | Turn the unit on or off | ✓ | ✓ |
| `mode` | Operation mode (auto, cool, heat, dry, fan) | ✓ | ✓ |
| `targetTemperature` | Desired room temperature | ✓ | ✓ |
| `indoorTemperature` | Current indoor temperature | ✓ | ✗ |
| `outdoorTemperature` | Current outdoor temperature | ✓ | ✗ |
| `fanSpeed` | Fan speed (auto, low, medium, high) | ✓ | ✓ |
| `swingMode` | Swing mode (off, vertical, horizontal, both) | ✓ | ✓ |
| `ecoMode` | Eco mode | ✓ | ✓ |
| `turboMode` | Turbo / powerful mode | ✓ | ✓ |
| `sleepMode` | Sleep mode | ✓ | ✓ |

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

* Only local serial control is supported. Cloud features (OSK) are explicitly not part of this adapter.
* The adapter currently supports a single indoor unit per instance.

## Changelog

### 0.0.2

* Align admin JSON config layout sizes with adapter checker requirements.
* Add required license metadata type information.
* Remove deprecated metadata and release version 0.0.2.

### 0.0.1

* Initial release of the adapter.

See [CHANGELOG.md](CHANGELOG.md).

## 💙 Unterstützung

Ich bastle an diesem Adapter in meiner Freizeit.  
Wenn er dir gefällt oder dir weiterhilft, freue ich mich über eine kleine Spende:

[![Spenden via PayPal](https://img.shields.io/badge/Spenden-PayPal-blue.svg?logo=paypal)](https://www.paypal.com/paypalme/AuhuberD)

## License

[GPLv3](LICENSE)

Copyright (c) 2025 DosOrDie
