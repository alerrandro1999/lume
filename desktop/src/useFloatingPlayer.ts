import { useEffect, useEffectEvent, useState } from 'react';
import type { FloatingPlayerCommand, FloatingPlayerState } from './types';

export function useFloatingPlayer(
  state: FloatingPlayerState,
  onCommand: (command: FloatingPlayerCommand, position?: number) => void,
  onExpand: () => void,
) {
  const { source, title, detail, position, duration, playing, loading, canSkip, error } = state;
  const [active, setActive] = useState(false);
  const handleCommand = useEffectEvent(onCommand);
  const expand = useEffectEvent(onExpand);

  useEffect(() => {
    const stopCommands = window.lume.onFloatingPlayerCommand((owner, command, time) => {
      if (owner === source) handleCommand(command, time);
    });
    const stopSource = window.lume.onFloatingPlayerSource(owner => setActive(owner === source));
    const stopExpand = window.lume.onFloatingPlayerExpand(owner => {
      if (owner === source) expand();
    });
    return () => { stopCommands(); stopSource(); stopExpand(); };
  }, [source]);

  useEffect(() => {
    if (active) void window.lume.updateFloatingPlayer({ source, title, detail, position, duration, playing, loading, canSkip, error }).catch(() => {});
  }, [active, source, title, detail, position, duration, playing, loading, canSkip, error]);

  return { active, open: () => window.lume.openFloatingPlayer(state) };
}
