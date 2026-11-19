const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const profile = path.join(root, '.lume-test-data/mac-branding/profile');
require('node:fs').mkdirSync(profile, { recursive: true });
app.setPath('userData', profile);
app.whenReady().then(async () => {
  const destination = path.join(root,'.lume-test-data/mac-branding'); await fs.mkdir(destination,{recursive:true});
  const svg = await fs.readFile(path.join(root,'resources/branding/lume.svg'),'utf8');
  const source = 'data:image/svg+xml;base64,'+Buffer.from(svg).toString('base64');
  const window = new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});
  try {
    await window.loadURL('data:text/html,<html></html>');
    const url = await window.webContents.executeJavaScript(`(async()=>{const image=new Image();image.src=${JSON.stringify(source)};await image.decode();const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;canvas.getContext('2d').drawImage(image,0,0,1024,1024);return canvas.toDataURL('image/png');})()`);
    await fs.writeFile(path.join(destination,'icon.png'),Buffer.from(url.split(',')[1],'base64'));
  } finally {window.destroy();}
  app.quit();
}).catch(error=>{console.error(error);app.exit(1);});
