/** GATT service used for the chat channel. */
export const SERVICE_UUID = '71f271d0-8f4c-4c4d-8a2d-6f3a9497b41d';
export const RX_CHARACTERISTIC_UUID = '4ad4a6d2-3f4a-477c-9832-5e0d8f7654d8';
export const TX_CHARACTERISTIC_UUID = '8b3e8c1f-5d42-4f77-a91d-6c3e2b8a5f19';
export const MAX_BYTES_PER_PACKET = 20;
export const MAX_HEX_PER_PACKET = MAX_BYTES_PER_PACKET * 2;
export const CHUNK_DELAY_MS = 30;
export const REASSEMBLY_TIMEOUT_MS = 15000;
export const MAX_ADVERTISED_NAME_LEN = 18;
export const START_FRAME_RE = /^\u001FBLK:S:([0-9a-f]{4}):(\d+)\u001F$/;
export const END_FRAME_RE = /^\u001FBLK:E:([0-9a-f]{4})\u001F$/;

export type ChatMessage = {
  id: string;
  text: string;
  sender: 'me' | 'other';
};
