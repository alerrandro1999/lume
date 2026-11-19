const path = require('node:path');

class Ocr {
  constructor(models, packaged, sendProgress) {
    this.models = models;
    this.packaged = packaged;
    this.sendProgress = sendProgress;
    this.worker = null;
    this.loading = null;
    this.busy = false;
    this.generation = 0;
    this.jobId = '';
    this.rejectJob = null;
  }

  async recognize(image, jobId, mode) {
    if (this.busy) throw new Error('Já existe um reconhecimento em andamento.');
    if (typeof jobId !== 'string' || jobId.length > 100 || !(image?.data instanceof Uint8Array) || image.data.length > 40 * 1024 * 1024 || !Number.isInteger(image.width) || !Number.isInteger(image.height) || image.width < 1 || image.height < 1 || image.width * image.height > 12000000 || Buffer.from(image.data.subarray(0, 8)).toString('hex') !== '89504e470d0a1a0a') throw new Error('Imagem de página inválida.');
    this.busy = true;
    this.jobId = jobId;
    const generation = this.generation;
    let rejectJob;
    const canceled = new Promise((_resolve, reject) => { rejectJob = reject; });
    this.rejectJob = rejectJob;
    try {
      if (!this.worker) {
        const { createWorker, OEM } = require('tesseract.js');
        const options = { langPath: this.models, gzip: false, cacheMethod: 'none', errorHandler: () => this.rejectJob?.(new Error('Não foi possível reconhecer esta página.')), logger: progress => { if (generation === this.generation) this.sendProgress({ jobId: this.jobId, progress: progress.progress || 0, status: progress.status }); } };
        if (this.packaged) options.workerPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'tesseract.js', 'src', 'worker-script', 'node', 'index.js');
        this.loading = createWorker(['por', 'eng'], OEM.LSTM_ONLY, options);
        const worker = await Promise.race([this.loading.then(async worker => {
          if (generation !== this.generation) { await worker.terminate(); throw new Error('OCR cancelado.'); }
          return worker;
        }), canceled]);
        this.loading = null;
        if (generation !== this.generation) { await worker.terminate(); throw new Error('OCR cancelado.'); }
        this.worker = worker;
      }
      const { PSM } = require('tesseract.js');
      await Promise.race([this.worker.setParameters({ tessedit_pageseg_mode: mode === 'region' ? PSM.SINGLE_BLOCK : PSM.AUTO }), canceled]);
      const { data } = await Promise.race([this.worker.recognize(Buffer.from(image.data), {}, { text: true, blocks: true }), canceled]);
      if (generation !== this.generation) throw new Error('OCR cancelado.');
      const words = [];
      const blocks = [];
      for (const block of data.blocks || []) for (const paragraph of block.paragraphs || []) {
        const start = words.length;
        for (const line of paragraph.lines || []) for (const word of line.words || []) {
          const { x0, y0, x1, y1 } = word.bbox;
          const x = Math.max(0, x0 / image.width), y = Math.max(0, y0 / image.height);
          const width = Math.min(1 - x, (x1 - x0) / image.width), height = Math.min(1 - y, (y1 - y0) / image.height);
          if (word.text.trim() && width > 0 && height > 0) words.push({ text: word.text.trim(), rect: { x, y, width, height } });
        }
        if (words.length > start) blocks.push({ text: paragraph.text?.trim() || words.slice(start).map(word => word.text).join(' '), wordCount: words.length - start });
      }
      return { text: data.text.trim(), confidence: Math.round(data.confidence), words, blocks, createdAt: new Date().toISOString() };
    } finally { if (this.rejectJob === rejectJob) this.rejectJob = null; if (generation === this.generation) this.busy = false; }
  }

  async cancel() {
    this.generation++;
    this.rejectJob?.(new Error('OCR cancelado.'));
    this.rejectJob = null;
    this.busy = false;
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}

module.exports = { Ocr };
