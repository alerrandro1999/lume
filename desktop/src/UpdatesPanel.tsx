import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { Modal } from './ReadingTools';
import type { UpdateState } from './types';
import './updates.css';
export function useUpdates() {
  const [state, setState] = useState<UpdateState | null>(null), [error, setError] = useState('');
  const [automatic, setAutomatic] = useState(() => { try { return localStorage.getItem('lume-update-check-on-start') === 'true'; } catch { return false; } });
  const accept = useCallback((value: UpdateState) => setState(previous => !previous || value.revision >= previous.revision ? value : previous), []);
  useEffect(() => { const unsubscribe = window.lume?.onUpdateState(accept); let canceled = false; void window.lume?.updateStatus().then(async value => { if (canceled) return; accept(value); if (automatic && value.stage === 'idle') accept(await window.lume.checkUpdates()); }).catch(() => { if (!canceled) setError('Não foi possível consultar as informações desta versão.'); }); return () => { canceled = true; unsubscribe?.(); }; }, []);
  const perform = async (operation: () => Promise<UpdateState>) => { setError(''); try { accept(await operation()); } catch (error) { setError(String(error).replace(/^Error: (Error invoking remote method '[^']+': Error: )?/, '')); } };
  const canUpdate = state?.channel === 'direct' && !['unconfigured', 'development'].includes(state.stage);
  const title = canUpdate ? 'Sobre e atualizações' : 'Sobre o Lume';
  return { state, error, automatic, perform, canUpdate, title, setAutomatic(value: boolean) { setAutomatic(value); try { localStorage.setItem('lume-update-check-on-start', String(value)); } catch { /* The choice remains active for this session. */ } } };
}
export function UpdatesPanel({ model, prepare, close }: { model: ReturnType<typeof useUpdates>; prepare(): Promise<void>; close(): void }) {
  const { state, error, automatic, perform, canUpdate, title } = model;
  return <Modal title={title} close={close}>
    <div className="updates-content">
      {state && <p className="update-version">Versão {state.version}</p>}
      {!state && !error && <p className="update-message" role="status">Carregando informações…</p>}
      {state && (canUpdate || state.channel === 'store') &&
        <p className={`update-message ${state.stage === 'error' ? 'update-error' : ''}`} role="status">{state.message}</p>}
      {error && <p className="study-error" role="alert">{error}</p>}
      {canUpdate && state && <>
        {state.availableVersion && <p className="update-available">Nova versão <strong>{state.availableVersion}</strong></p>}
        {state.stage === 'downloading' && <div className="update-download">
          <progress max={100} value={state.percent} aria-label="Progresso do download da atualização" />
          <span>{Math.floor(state.percent)}%{state.total > 0 && ` · ${(state.transferred / 1024 ** 2).toFixed(1)} de ${(state.total / 1024 ** 2).toFixed(1)} MB`}</span>
        </div>}
        <div className="study-actions">
          {!['downloaded', 'installing', 'downloading'].includes(state.stage) &&
            <button className="secondary-button" disabled={state.stage === 'checking'} onClick={() => void perform(() => window.lume.checkUpdates())}><RefreshCw size={15} />Verificar atualizações</button>}
          {(state.stage === 'available' || state.stage === 'error' && state.availableVersion) &&
            <button className="primary-button" onClick={() => void perform(() => window.lume.downloadUpdate())}>Baixar atualização</button>}
          {state.stage === 'downloaded' &&
            <button className="primary-button" onClick={() => void perform(async () => { await prepare(); return window.lume.installUpdate(); })}>Salvar leitura e reiniciar para atualizar</button>}
        </div>
        <label className="update-option"><input type="checkbox" checked={automatic} onChange={event => model.setAutomatic(event.target.checked)} />Verificar novas versões ao iniciar o Lume</label>
        {state.checkedAt && <p className="update-checked">Última consulta em {new Date(state.checkedAt).toLocaleString('pt-BR')}</p>}
      </>}
    </div>
  </Modal>;
}
