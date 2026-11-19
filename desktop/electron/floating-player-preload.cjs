const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lumeFloatingPlayer', {
  read: () => ipcRenderer.invoke('floating-player:read'),
  command: (command, position) => ipcRenderer.invoke('floating-player:command', command, position),
  onState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('floating-player:state', listener);
    return () => ipcRenderer.removeListener('floating-player:state', listener);
  },
});
