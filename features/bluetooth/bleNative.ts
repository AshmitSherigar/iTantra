import { Platform } from 'react-native';
import type * as BleLibType from 'react-native-bluetooth-ble';

const noop = () => {};
const asyncNoop = async () => {};
const asyncFalse = async () => false;
const asyncEmptyArray = async () => [] as never[];
const removeListenerStub = () => {};

const webStub = {
  startAdvertising: noop,
  stopAdvertising: noop,
  updateAdvertisingData: noop,
  getAdvertisingData: async () => ({}) as never,
  setServices: noop,
  updateCharacteristicValue: asyncNoop,
  isBluetoothEnabled: asyncFalse,
  requestBluetoothPermission: asyncFalse,
  getCapabilities: async () => ({}) as never,
  startScan: noop,
  stopScan: noop,
  connect: asyncNoop,
  disconnect: noop,
  discoverServices: asyncEmptyArray,
  readCharacteristic: async () => ({}) as never,
  readDescriptor: async () => ({}) as never,
  writeCharacteristic: asyncNoop,
  writeDescriptor: asyncNoop,
  subscribeToCharacteristic: noop,
  unsubscribeFromCharacteristic: noop,
  getConnectedDevices: asyncEmptyArray,
  readRSSI: async () => 0,
  requestMTU: async () => 0,
  setPreferredPhy: asyncNoop,
  readPhy: async () => ({}) as never,
  getBondState: async () => 'unbonded' as never,
  createBond: async () => 'unbonded' as never,
  removeBond: async () => 'unbonded' as never,
  startExtendedAdvertising: async () => '',
  stopExtendedAdvertising: noop,
  publishL2CAPChannel: async () => ({}) as never,
  unpublishL2CAPChannel: noop,
  openL2CAPChannel: async () => ({}) as never,
  closeL2CAPChannel: noop,
  sendL2CAPData: asyncNoop,
  startClassicScan: noop,
  stopClassicScan: noop,
  connectClassic: asyncNoop,
  startClassicServer: asyncNoop,
  stopClassicServer: noop,
  disconnectClassic: noop,
  writeClassic: asyncNoop,
  startBackgroundSession: noop,
  stopBackgroundSession: noop,
  startMultipeerSession: noop,
  stopMultipeerSession: noop,
  inviteMultipeerPeer: noop,
  getMultipeerPeers: asyncEmptyArray,
  sendMultipeerMessage: asyncNoop,
  addDeviceFoundListener: () => removeListenerStub,
  addEventListener: () => removeListenerStub,
  addListener: noop,
  removeListeners: noop,
} as unknown as typeof BleLibType;

let cached: typeof BleLibType | null | undefined;

function loadBleLib(): typeof BleLibType {
  if (Platform.OS === 'web') return webStub;
  if (cached !== undefined) return cached ?? webStub;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    cached = require('react-native-bluetooth-ble') as typeof BleLibType;
  } catch {
    cached = null;
  }
  return cached ?? webStub;
}

export const Ble: typeof BleLibType = new Proxy(webStub, {
  get(_target, prop: string | symbol) {
    const lib = loadBleLib();
    const value = (lib as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === 'function') {
      return (...args: unknown[]) =>
        (value as (...a: unknown[]) => unknown).apply(lib, args);
    }
    return value;
  },
});
