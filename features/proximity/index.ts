/**
 * Device-search proximity feature (find a nearby phone, hot/cold guidance).
 *
 * Transport note: BLE discovery + RSSI come from the GLOBAL mesh runtime
 * (root-mounted) — this screen subscribes and triggers shared discovery
 * rounds but owns no BLE state. WiFi presence uses its own UDP discovery
 * socket (no TCP server here, so chat transports are untouched).
 */
export * from './rssi';
export * from './distance';
export * from './protocol';
export * from './useProximityBeep';
export * from './useDeviceSearch';
