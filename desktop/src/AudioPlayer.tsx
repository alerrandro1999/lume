import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { PictureInPicture2 } from 'lucide-react';
import { Modal } from './ReadingTools';
import { audioTime as clock } from './audio-time';
import type { AudioTrack, ExportedAudiobook } from './types';
import { useFloatingPlayer } from './useFloatingPlayer';
import { useListeningSession } from './useListeningSession';
import { useMediaControls } from './useMediaControls';

export function AudioPlayer({ opened, open, close, stopNarration, exportRequest, mediaActive, onPlayback }: {
  opened: boolean;
  open(): void;
  close(): void;
  stopNarration(): void;
  exportRequest: { directory: string } | null;
  mediaActive: boolean;
  onPlayback(): void;
}) {
  const element = useRef<HTMLAudioElement>(null), current = useRef<AudioTrack | null>(null), lastSave = useRef(0), lastPlaying = useRef(false);
  const [tracks, setTracks] = useState<AudioTrack[]>([]), [track, setTrack] = useState<AudioTrack | null>(null), [error, setError] = useState(''), [position, setPosition] = useState(0), [length, setLength] = useState(0), [playing, setPlaying] = useState(false), [rate, setRate] = useState(1), [label, setLabel] = useState(''), [deadline, setDeadline] = useState(0), [minutes, setMinutes] = useState(30), [remaining, setRemaining] = useState(0);
  const [playlist, setPlaylist] = useState<ExportedAudiobook | null>(null);
  const [audible, setAudible] = useState(false);
  const trackRequest = useRef(0);
  current.current = track;
  const save = () => { const audio = element.current, item = current.current; if (audio && item && audio.currentSrc === item.url && Number.isFinite(audio.currentTime)) { item.position = audio.currentTime; item.rate = audio.playbackRate; setTracks(items => items.map(entry => entry.id === item.id ? { ...entry, position: item.position, rate: item.rate } : entry)); void window.lume.playerProgress(item.id, audio.currentTime, audio.playbackRate).catch(error => setError(String(error))); } };
  useEffect(() => { if (opened) { window.lume.playerList().then(items => { setTracks(items); if (!current.current && items[0]) select(items[0], false); }).catch(error => setError(String(error))); } }, [opened]);
  useEffect(() => window.lume.onPlayerSleep(() => { element.current?.pause(); save(); setDeadline(0); setError('Temporizador concluído. A reprodução foi pausada.'); }), []);
  useEffect(() => { const pause = () => { element.current?.pause(); save(); }; window.addEventListener('lume-pause-audio', pause); return () => { pause(); window.removeEventListener('lume-pause-audio', pause); }; }, []);
  const flush = useEffectEvent(() => {
    const audio = element.current, item = current.current;
    if (audio && item && audio.currentSrc === item.url) window.lume.playerCheckpoint(item.id, audio.currentTime, audio.playbackRate);
  });
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);
  useEffect(() => { if (!deadline) { setRemaining(0); return; } const tick = () => setRemaining(Math.max(0, Math.ceil((deadline - Date.now()) / 1000))); tick(); const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, [deadline]);
  function select(item: AudioTrack, autoplay: boolean) {
    const audio = element.current;
    const sameSource = audio?.currentSrc === item.url;
    if (sameSource) {
      if (!autoplay) audio.pause();
      save();
      setTrack({ ...item, position: audio.currentTime, rate: audio.playbackRate });
    } else {
      save();
      audio?.pause();
      setTrack(item);
      current.current = item;
      setPosition(item.position);
      setRate(item.rate || 1);
      setLength(item.duration || 0);
      lastPlaying.current = autoplay;
    }
    setError('');
  }
  async function choose() { setError(''); try { const items = await window.lume.playerChoose(); if (items?.length) { setTracks(await window.lume.playerList()); selectFile(items[0]); } } catch (error) { setError(String(error).replace(/^Error: /, '')); } }
  function selectFile(item: AudioTrack) {
    trackRequest.current++;
    setPlaylist(null);
    select(item, false);
  }
  async function openExport(directory: string, index?: number, autoplay = false) {
    const request = ++trackRequest.current;
    try {
      const exported = await window.lume.playerOpenExport(directory, index);
      const items = await window.lume.playerList();
      if (request !== trackRequest.current) return;
      setPlaylist(exported);
      setTracks(items);
      select(exported.track, autoplay);
    } catch (error) {
      if (request === trackRequest.current) setError(String(error).replace(/^Error: (Error invoking remote method '[^']+': Error: )?/, ''));
    }
  }
  const loadExport = useEffectEvent((directory: string) => void openExport(directory));
  useEffect(() => { if (exportRequest) loadExport(exportRequest.directory); }, [exportRequest]);
  async function toggle() { if (!element.current) return; if (!element.current.paused) element.current.pause(); else { stopNarration(); try { await element.current.play(); } catch { setError('Não foi possível reproduzir este áudio. O arquivo pode ter sido movido, estar danificado ou usar um codec/DRM não suportado.'); } } }
  useListeningSession(playlist?.bookId, playing && audible);
  useMediaControls('file', mediaActive && !!track, playlist?.title || track?.title || '', track?.author || 'Audiobook', playing, play => {
    if (element.current && element.current.paused === play) void toggle();
  });
  const seek = (time: number) => { if (element.current && Number.isFinite(length) && length > 0) { element.current.currentTime = Math.max(0, Math.min(length, time)); setPosition(element.current.currentTime); save(); } };
  const floating = useFloatingPlayer({
    source: 'file',
    title: playlist?.title || track?.title || '',
    detail: playlist ? playlist.chapters[playlist.index] : track?.author || '',
    position: Math.floor(position),
    duration: length,
    playing,
    error,
  }, (command, time) => {
    if (command === 'toggle') void toggle();
    else if (command === 'seek' && time !== undefined) seek(time);
    else if (command === 'rewind' || command === 'forward') {
      seek((element.current?.currentTime ?? position) + (command === 'forward' ? 15 : -15));
    }
  }, open);

  async function floatPlayer() {
    try {
      await floating.open();
      close();
    } catch {
      setError('Não foi possível abrir o player flutuante.');
    }
  }

  const currentChapter = track?.chapters.filter(chapter => chapter.start <= position).at(-1);
  function nextTrack() {
    setPlaying(false);
    setAudible(false);
    save();
    if (playlist) {
      if (playlist.index + 1 < playlist.chapters.length) void openExport(playlist.directory, playlist.index + 1, true);
      return;
    }
    const index = tracks.findIndex(item => item.id === current.current?.id);
    if (index >= 0 && tracks[index + 1]) select(tracks[index + 1], true);
  }
  return <>
    <audio ref={element} src={track?.url} preload="metadata"
      onLoadedMetadata={() => {
        const audio = element.current!, item = current.current;
        const duration = Number.isFinite(audio.duration) ? audio.duration : item?.duration || 0;
        setLength(duration);
        audio.playbackRate = item?.rate || 1;
        if (item) audio.currentTime = item.position >= duration ? 0 : item.position;
        if (lastPlaying.current) { lastPlaying.current = false; void toggle(); }
      }}
      onPlay={() => { setPlaying(true); onPlayback(); }}
      onPlaying={() => setAudible(true)}
      onWaiting={() => setAudible(false)}
      onPause={() => { setPlaying(false); setAudible(false); save(); }}
      onTimeUpdate={() => {
        const audio = element.current!;
        setPosition(audio.currentTime);
        if (Date.now() - lastSave.current > 5000) { lastSave.current = Date.now(); save(); }
      }}
      onEnded={nextTrack}
      onError={() => {
        setPlaying(false);
        setAudible(false);
        if (current.current) setError('Não foi possível carregar o áudio. Mantenha o arquivo na pasta original e verifique o formato.');
      }}
      className="local-audio-element" />
    {!opened && !floating.active && playing && <button className="audio-mini-player" onClick={() => { element.current?.pause(); save(); }}>♫ {playlist?.title || track?.title} · {clock(position)} · Pausar</button>}
    {opened && <Modal title="Player de audiobooks" close={close}><div className="audio-player-content"><p className="study-help">Abra MP3, M4B, M4A ou WAV do computador. A posição e os marcadores ficam salvos; mantenha o arquivo na pasta original. Capítulos aparecem quando estão nos metadados.</p>
      <div className="audio-player-actions">
        <button className="primary-button" onClick={() => void choose()}>Abrir áudio</button>
        {track && <button className="secondary-button" onClick={() => void floatPlayer()}><PictureInPicture2 size={16} />Player flutuante</button>}
      </div>
      {error && <p className="study-error" role="status">{error}</p>}{tracks.length > 0 && <label className="audio-track-label">Audiobook<select aria-label="Audiobook atual" value={track?.id || ''} onChange={event => { const item = tracks.find(item => item.id === event.target.value); if (item) selectFile(item); }}>{tracks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>}
      {track && <><h3>{playlist?.title || track.title}</h3>{track.author && <p>{track.author}</p>}
      {playlist && <label className="audio-track-label">Capítulo do audiobook<select value={playlist.index} onChange={event => void openExport(playlist.directory, Number(event.target.value), playing)}>
        {playlist.chapters.map((title, index) => <option key={index} value={index}>{index + 1}. {title}</option>)}
      </select></label>}
      <div className="audio-player-controls"><button aria-label="Retroceder 15 segundos" onClick={() => seek(position - 15)}>−15 s</button><button className="primary-button" onClick={() => void toggle()}>{playing ? 'Pausar audiobook' : 'Reproduzir audiobook'}</button><button aria-label="Avançar 15 segundos" onClick={() => seek(position + 15)}>+15 s</button><select aria-label="Velocidade do audiobook" value={rate} onChange={event => { const value = Number(event.target.value); setRate(value); if (element.current) element.current.playbackRate = value; save(); }}>{[.5, .75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3].map(value => <option key={value} value={value}>{value}×</option>)}</select></div><input className="audio-seek" aria-label="Posição do audiobook" type="range" min={0} max={Math.max(1, length)} step={.1} value={Math.min(position, length || position)} onChange={event => seek(Number(event.target.value))} /><div className="audio-clock">{clock(position)} / {clock(length)}{currentChapter && <span>{currentChapter.title}</span>}</div>
      {!!track.chapters.length && <details className="audio-chapters"><summary>Capítulos ({track.chapters.length})</summary>{track.chapters.map((chapter, index) => <button key={index} onClick={() => seek(chapter.start)}>{clock(chapter.start)} · {chapter.title}</button>)}</details>}
      <div className="audio-sleep"><label>Temporizador de sono<select aria-label="Temporizador de sono" value={minutes} onChange={event => setMinutes(Number(event.target.value))}>{[5, 10, 15, 30, 45, 60, 90, 120, 180].map(value => <option key={value} value={value}>{value} min</option>)}</select></label><button className="secondary-button" onClick={() => void window.lume.playerSleep(deadline ? 0 : minutes).then(setDeadline).catch(error => setError(String(error)))}>{deadline ? `Cancelar temporizador · ${clock(remaining)}` : 'Ativar temporizador'}</button></div>
      <form className="audio-bookmark-form" onSubmit={event => { event.preventDefault(); void window.lume.playerBookmark(track.id, { label: label.trim() || `Trecho ${clock(position)}`, time: position }).then(items => { setTracks(items); setTrack(items.find(item => item.id === track.id) || track); setLabel(''); }).catch(error => setError(String(error))); }}><input aria-label="Nome do marcador de áudio" value={label} maxLength={160} placeholder="Nome do marcador" onChange={event => setLabel(event.target.value)} /><button className="secondary-button">Marcar posição do áudio</button></form>
      <div className="audio-bookmarks">{track.bookmarks.map(mark => <article key={mark.id}><button onClick={() => seek(mark.time)}>{clock(mark.time)} · {mark.label}</button><button aria-label={`Excluir marcador de áudio ${mark.label}`} onClick={() => void window.lume.playerRemoveBookmark(track.id, mark.id).then(items => { setTracks(items); setTrack(items.find(item => item.id === track.id) || track); })}>×</button></article>)}</div></>}
    </div></Modal>}
  </>;
}
