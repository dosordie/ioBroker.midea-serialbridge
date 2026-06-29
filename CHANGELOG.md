# Changelog

## **WORK IN PROGRESS**

## 0.0.11 (2026-06-09)

- add regular `getGroup43Data` polling for C1 Group 43 diagnostics
- expose C1 Group 43 byte 10 as `outdoorFanCommandCandidate` without rpm semantics
- add compact Group 43 raw hex states and skip Group 43 in unknown-group polling

## 0.0.10 (2026-06-09)

- remove the legacy custom-polling switch from the Admin UI and ignore legacy customPolling fields during normalization
- normalize pollingRequests as the authoritative polling table, including migration from legacy polling.requests, duplicate cleanup, interval validation and missing default entries
- align German and English polling request labels with C0, B5 and C1 Group naming

## 0.0.9 (2026-06-08)

- extend safe unknown-group diagnosis polling to optional group bytes 0x20-0x7F with up to 16 sequential groups while skipping regular groups 0x41, 0x44 and 0x45
- rename C1 Group 41 diagnostic datapoints for confirmed compressor, indoor pipe, indoor heat exchanger and outdoor-temperature meanings
- expose C1 Group 41 byte 08 neutrally as raw value plus one temperature candidate and keep byte 12 marked as an outdoor heat-exchanger temperature candidate
- delete legacy Group 41 candidate sensor states on startup and keep raw debug output compact without rawByte/analogCandidates mass states

## 0.0.8 (2026-06-08)

- add optional automatic adapter restart on connection errors with configurable delay
- remove raw byte and analog candidate analysis states; keep only compact raw hex debug output

## 0.0.2 (2025-09-30)

- align admin JSON config layout sizes with the adapter checker requirements
- add license metadata type information required by the adapter checker
- remove deprecated metadata and bump the adapter version to 0.0.2

## 0.0.1 (2025-09-27)

- initial release
