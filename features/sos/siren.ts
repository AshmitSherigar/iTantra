import { Audio } from 'expo-av';
import type { AVPlaybackStatus } from 'expo-av';

// Bundled two-tone siren (generated, loops seamlessly).
const SIREN_ASSET = require('../../assets/sounds/siren.wav');

let sound: Audio.Sound | null = null;
let playing = false;
const playingListeners = new Set<(on: boolean) => void>();

function setPlaying(on: boolean): void {
  if (playing === on) return;
  playing = on;
  playingListeners.forEach((fn) => {
    try {
      fn(on);
    } catch {}
  });
}

export function onSirenPlayingChange(fn: (on: boolean) => void): () => void {
  playingListeners.add(fn);
  return () => {
    playingListeners.delete(fn);
  };
}

export function isSirenPlaying(): boolean {
  return playing;
}

function onStatus(status: AVPlaybackStatus): void {
  if (!status.isLoaded && playing) {
    // Interrupted / unloaded externally — reflect reality in UI.
    setPlaying(false);
    sound = null;
  }
}

/** Loop the SOS siren at full volume until stopSosSiren(). Safe to call twice. */
export async function playSosSiren(): Promise<void> {
  try {
    await Audio.setAudioModeAsync({
      allowsRecordingIOS: false,
      playsInSilentModeIOS: true,
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playThroughEarpieceAndroid: false,
    });
  } catch {}
  try {
    if (sound) {
      try {
        await sound.setIsLoopingAsync(true);
        await sound.setVolumeAsync(1.0);
        await sound.replayAsync();
      } catch {
        try {
          await sound.unloadAsync();
        } catch {}
        sound = null;
      }
      if (sound) {
        setPlaying(true);
        return;
      }
    }
    const created = await Audio.Sound.createAsync(
      SIREN_ASSET,
      { shouldPlay: true, isLooping: true, volume: 1.0 },
      onStatus,
    );
    sound = created.sound;
    setPlaying(true);
  } catch (e) {
    console.warn('[SOS] siren play failed:', e);
  }
}

/** Stop the siren and release the player. */
export async function stopSosSiren(): Promise<void> {
  setPlaying(false);
  const current = sound;
  sound = null;
  if (!current) return;
  try {
    await current.stopAsync();
  } catch {}
  try {
    await current.unloadAsync();
  } catch {}
}
