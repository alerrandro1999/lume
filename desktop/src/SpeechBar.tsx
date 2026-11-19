import { LoaderCircle, Pause, PictureInPicture2, Play, SkipBack, SkipForward, Square, Volume2, X } from 'lucide-react';
import type { Narrator } from './useNarrator';

export function SpeechBar({ speech, onFloat }: { speech: Narrator; onFloat(): void }) {
  return <section className="speech-bar" hidden={!speech.visible} aria-label="Leitura em voz alta">
    <audio ref={speech.audio} onEnded={() => void speech.advance(1, true)} onTimeUpdate={speech.timeUpdate} onLoadedMetadata={speech.timeUpdate} />
    <Volume2 size={17} className="speech-symbol" />
    <div className="speech-buttons">
      <button className="icon-button" aria-label="Trecho anterior" onClick={() => void speech.advance(-1)} disabled={speech.status === 'idle' || speech.status === 'loading'}><SkipBack size={16} /></button>
      <button className="icon-button speech-play" aria-label={speech.status === 'playing' || speech.status === 'loading' ? 'Pausar narração' : 'Reproduzir narração'} onClick={() => void speech.toggle()}>{speech.status === 'loading' ? <LoaderCircle size={18} className="spinner" /> : speech.status === 'playing' ? <Pause size={18} /> : <Play size={18} />}</button>
      <button className="icon-button" aria-label="Próximo trecho" onClick={() => void speech.advance()} disabled={speech.status === 'idle' || speech.status === 'loading'}><SkipForward size={16} /></button>
      <button className="icon-button" aria-label="Parar narração" onClick={speech.stop} disabled={speech.status === 'idle'}><Square size={14} /></button>
    </div>
    <div className="speech-progress"><span role="status">{speech.sleepFinished ? 'Temporizador concluído' : speech.status === 'loading' ? 'Preparando a voz…' : speech.status === 'paused' ? 'Narração pausada' : speech.status === 'playing' ? `${speech.unit} ${speech.position.page} · trecho ${speech.position.chunk} de ${speech.position.total}` : speech.error || 'Pronto para ouvir'}</span><input type="range" min={0} max={Math.max(1, speech.position.duration)} step={0.1} value={Math.min(speech.position.time, speech.position.duration)} aria-label="Posição do áudio" onChange={event => speech.seek(Number(event.target.value))} disabled={!speech.position.duration} /></div>
    <select className="voice-select" aria-label="Voz da narração" value={speech.voice} onChange={event => speech.chooseVoice(event.target.value)}>{speech.voices.map(voice => <option key={voice.name} value={voice.name}>{voice.name.replace('Microsoft ', '').replace(' Desktop', '')} ({voice.language})</option>)}{!speech.voices.length && <option value="">Sem voz instalada</option>}</select>
    <select aria-label="Velocidade da narração" value={speech.rate} onChange={event => speech.changeRate(Number(event.target.value))}>{[0.5, 0.75, 1, 1.25, 1.5, 2].map(rate => <option value={rate} key={rate}>{rate.toLocaleString('pt-BR')}×</option>)}</select>
    <select aria-label="Temporizador da narração" title="Temporizador da narração" value={speech.sleep} onChange={event => {
      const value = event.target.value;
      speech.changeSleep(value === 'page' ? 'page' : Number(value) as 0 | 15 | 30 | 60);
    }}>
      <option value={0}>Timer desligado</option>
      {[15, 30, 60].map(minutes => <option key={minutes} value={minutes}>{minutes} min</option>)}
      <option value="page">Fim da {speech.unit.toLocaleLowerCase('pt-BR')}</option>
    </select>
    <button className="icon-button" aria-label="Player flutuante da narração" title="Player flutuante" onClick={onFloat}><PictureInPicture2 size={17} /></button>
    <button className="icon-button" aria-label="Fechar narração" onClick={speech.close}><X size={16} /></button>
  </section>;
}
