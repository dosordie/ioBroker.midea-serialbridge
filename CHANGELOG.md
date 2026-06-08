# Changelog

## **WORK IN PROGRESS**

- expose Group 41 raw frame/payload hex values and update compact raw hex output with Group 41 frames
- expand safe unknown-group diagnosis polling to optional group bytes 0x30-0x5F with up to 16 sequential groups

- add optional automatic adapter restart on connection errors with configurable delay
- remove raw byte and analog candidate analysis states; keep only compact raw hex debug output

## 0.0.2 (2025-09-30)

- align admin JSON config layout sizes with the adapter checker requirements
- add license metadata type information required by the adapter checker
- remove deprecated metadata and bump the adapter version to 0.0.2

## 0.0.1 (2025-09-27)

- initial release
