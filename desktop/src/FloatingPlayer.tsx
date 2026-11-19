import { useEffect, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { LoaderCircle, Maximize2, Pause, Play, RotateCcw, RotateCw, SkipBack, SkipForward, X } from 'lucide-react';
import { audioTime } from './audio-time';
import type { FloatingPlayerState } from './types';
import lumeLogo from '../resources/branding/lume.svg?no-inline';
import './floating-player.css';

function PlayerButton({ label, onClick, children, className = '', disabled = false }: {
  label: string;
  onClick(): void;
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className={className}>{children}</button>;
}

function FloatingPlayer() {
  const [state, setState] = useState<FloatingPlayerState | null>(null);
  const [error, setError] = useState('');
  const api = window.lumeFloatingPlayer;

  useEffect(() => {
    const unsubscribe = api.onState(setState);
    void api.read().then(setState).catch(() => setError('Não foi possível consultar a reprodução.'));
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') void api.command('close').catch(() => {});
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => { unsubscribe(); window.removeEventListener('keydown', closeOnEscape); };
  }, [api]);

  function command(action: Parameters<typeof api.command>[0], position?: number) {
    setError('');
    void api.command(action, position).catch(() => setError('Não foi possível controlar a reprodução.'));
  }

  const duration = state?.duration ?? 0;
  const position = Math.min(state?.position ?? 0, duration);
  const narration = state?.source === 'narration';
  const canSkip = narration ? state?.canSkip : !!duration;
  const mediaLabel = narration ? 'narração' : 'audiobook';
  const status = error || state?.error;
  return <main className="floating-player" aria-label="Player flutuante de audiobooks">
    <header className="floating-header">
      <img src={lumeLogo} width={36} height={36} alt="" />
      <div className="floating-info">
        <h1 title={state?.title}>{state?.title || 'Audiobook'}</h1>
        {status
          ? <p role="status" title={status} className="floating-status">{status}</p>
          : state?.loading ? <p role="status">Preparando a voz…</p>
          : state?.detail && <p title={state.detail}>{state.detail}</p>}
      </div>
      <PlayerButton label={narration ? 'Voltar ao livro' : 'Abrir player completo'} onClick={() => command('expand')}><Maximize2 size={15} /></PlayerButton>
      <PlayerButton label="Fechar player flutuante" onClick={() => command('close')}><X size={18} /></PlayerButton>
    </header>

    <div className="floating-controls">
      <PlayerButton label={narration ? 'Trecho anterior' : 'Retroceder 15 segundos'} onClick={() => command('rewind')} disabled={!canSkip} className="floating-skip">
        {narration ? <SkipBack size={20} /> : <><RotateCcw size={24} /><span aria-hidden="true">15</span></>}
      </PlayerButton>
      <PlayerButton label={state?.playing ? `Pausar ${mediaLabel}` : `Reproduzir ${mediaLabel}`} onClick={() => command('toggle')} disabled={!state?.title} className="floating-toggle">
        {state?.loading ? <LoaderCircle size={19} /> : state?.playing ? <Pause size={19} fill="currentColor" /> : <Play size={19} fill="currentColor" />}
      </PlayerButton>
      <PlayerButton label={narration ? 'Próximo trecho' : 'Avançar 15 segundos'} onClick={() => command('forward')} disabled={!canSkip} className="floating-skip">
        {narration ? <SkipForward size={20} /> : <><RotateCw size={24} /><span aria-hidden="true">15</span></>}
      </PlayerButton>
    </div>

    <div className="floating-timeline">
      <span aria-hidden="true">{audioTime(position)}</span>
      <input aria-label={narration ? 'Posição do trecho' : 'Posição do audiobook'} aria-valuetext={`${audioTime(position)} de ${audioTime(duration)}`} type="range" min={0} max={duration || 1} step={narration ? .1 : 1} value={position}
        disabled={!duration} onChange={event => command('seek', Number(event.target.value))} />
      <span aria-hidden="true">{audioTime(duration)}</span>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<FloatingPlayer />);
