import { useEffect, useEffectEvent } from 'react';
import type { FloatingPlayerSource } from './types';

export function useMediaControls(source: FloatingPlayerSource, active: boolean, title: string, detail: string, playing: boolean, control: (play: boolean) => void) {
  const change = useEffectEvent(control);
  const toggle = useEffectEvent(() => control(!playing));
  useEffect(() => {
    if (!active) return;
    void window.lume.mediaKeys(source, true).catch(() => {});
    const unsubscribe = window.lume.onMediaToggle(owner => { if (owner === source) toggle(); });
    return () => { unsubscribe(); void window.lume.mediaKeys(source, false).catch(() => {}); };
  }, [active, source]);
  useEffect(() => {
    if (!active || !navigator.mediaSession) return;
    const media = navigator.mediaSession;
    media.metadata = new MediaMetadata({ title, artist: detail, album: 'Lume Leitor' });
    media.playbackState = playing ? 'playing' : 'paused';
    media.setActionHandler('play', () => change(true));
    media.setActionHandler('pause', () => change(false));
    media.setActionHandler('stop', () => change(false));
    return () => {
      media.setActionHandler('play', null);
      media.setActionHandler('pause', null);
      media.setActionHandler('stop', null);
      media.metadata = null;
      media.playbackState = 'none';
    };
  }, [active, title, detail, playing]);
}
