const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('lume', {
  writing: {
    list: () => ipcRenderer.invoke('writing:list'), open: id => ipcRenderer.invoke('writing:open',id), create: value => ipcRenderer.invoke('writing:create',value), remove: id => ipcRenderer.invoke('writing:remove',id),
    stage: (id,value,token) => ipcRenderer.invoke('writing:stage',id,value,token), flush: id => ipcRenderer.invoke('writing:flush',id), options: () => ipcRenderer.invoke('writing:options'), sources: query => ipcRenderer.invoke('writing:sources',query),
    citation: (id,source,value) => ipcRenderer.invoke('writing:citation',id,source,value), removeCitation: (id,citationId) => ipcRenderer.invoke('writing:remove-citation',id,citationId), openSource: source => ipcRenderer.invoke('writing:open-source',source),
    version: (id,label) => ipcRenderer.invoke('writing:version',id,label), restore: (id,versionId) => ipcRenderer.invoke('writing:restore',id,versionId), removeVersion: (id,versionId) => ipcRenderer.invoke('writing:remove-version',id,versionId), review: id => ipcRenderer.invoke('writing:review',id), export: (id,format) => ipcRenderer.invoke('writing:export',id,format),
    onSaved: callback => { const listener = (_event,value) => callback(value); ipcRenderer.on('writing:saved',listener); return () => ipcRenderer.removeListener('writing:saved',listener); },
  },
  portfolio: {
    read: () => ipcRenderer.invoke('portfolio:read'), profile: value => ipcRenderer.invoke('portfolio:profile', value), preferences: value => ipcRenderer.invoke('portfolio:preferences', value),
    entry: (id, value) => ipcRenderer.invoke('portfolio:entry', id, value), removeEntry: id => ipcRenderer.invoke('portfolio:remove-entry', id), toggle: (id, visible) => ipcRenderer.invoke('portfolio:toggle', id, visible), move: (id, delta) => ipcRenderer.invoke('portfolio:move', id, delta),
    skill: (id, value) => ipcRenderer.invoke('portfolio:skill', id, value), removeSkill: id => ipcRenderer.invoke('portfolio:remove-skill', id), log: (id, value) => ipcRenderer.invoke('portfolio:log', id, value), removeLog: id => ipcRenderer.invoke('portfolio:remove-log', id),
    projects: () => ipcRenderer.invoke('portfolio:projects'), importProject: id => ipcRenderer.invoke('portfolio:import-project', id), openProject: id => ipcRenderer.invoke('portfolio:open-project', id),
    evidence: id => ipcRenderer.invoke('portfolio:evidence', id), removeEvidence: id => ipcRenderer.invoke('portfolio:remove-evidence', id), openEvidence: id => ipcRenderer.invoke('portfolio:open-evidence', id), openUrl: id => ipcRenderer.invoke('portfolio:open-url', id),
    preview: () => ipcRenderer.invoke('portfolio:preview'), export: format => ipcRenderer.invoke('portfolio:export', format),
  },
  research: {
    list: () => ipcRenderer.invoke('research:list'), open: id => ipcRenderer.invoke('research:open', id), create: value => ipcRenderer.invoke('research:create', value),
    settings: (id, value) => ipcRenderer.invoke('research:settings', id, value), plan: (id, value) => ipcRenderer.invoke('research:plan', id, value), remove: id => ipcRenderer.invoke('research:remove', id),
    stage: (id, stageId, value) => ipcRenderer.invoke('research:stage', id, stageId, value), removeStage: (id, stageId) => ipcRenderer.invoke('research:remove-stage', id, stageId),
    task: (id, taskId, value) => ipcRenderer.invoke('research:task', id, taskId, value), move: (id, taskId, status) => ipcRenderer.invoke('research:move', id, taskId, status), removeTask: (id, taskId) => ipcRenderer.invoke('research:remove-task', id, taskId),
    meeting: (id, meetingId, value, createTasks) => ipcRenderer.invoke('research:meeting', id, meetingId, value, createTasks), removeMeeting: (id, meetingId) => ipcRenderer.invoke('research:remove-meeting', id, meetingId),
    sources: () => ipcRenderer.invoke('research:sources'), material: (id, value) => ipcRenderer.invoke('research:material', id, value), files: id => ipcRenderer.invoke('research:files', id),
    openMaterial: (id, materialId) => ipcRenderer.invoke('research:open-material', id, materialId), removeMaterial: (id, materialId) => ipcRenderer.invoke('research:remove-material', id, materialId), export: (id, format) => ipcRenderer.invoke('research:export', id, format),
  },
  conceptMaps: {
    list: () => ipcRenderer.invoke('concept-maps:list'),
    open: id => ipcRenderer.invoke('concept-maps:open', id),
    create: title => ipcRenderer.invoke('concept-maps:create', title),
    save: (id, value) => ipcRenderer.invoke('concept-maps:save', id, value),
    remove: id => ipcRenderer.invoke('concept-maps:remove', id),
    sources: query => ipcRenderer.invoke('concept-maps:sources', query),
    resolve: source => ipcRenderer.invoke('concept-maps:resolve', source),
    import: () => ipcRenderer.invoke('concept-maps:import'),
    export: (id, format) => ipcRenderer.invoke('concept-maps:export', id, format),
  },
  presentations: {
    list: () => ipcRenderer.invoke('presentations:list'),
    save: (id, value) => ipcRenderer.invoke('presentations:save', id, value),
    remove: id => ipcRenderer.invoke('presentations:remove', id),
    begin: (id, audio) => ipcRenderer.invoke('presentations:begin', id, audio),
    append: (id, index, bytes) => ipcRenderer.invoke('presentations:append', id, index, bytes),
    checkpoint: id => ipcRenderer.invoke('presentations:checkpoint', id),
    pause: (id, paused) => ipcRenderer.invoke('presentations:pause', id, paused),
    section: (id, section) => ipcRenderer.invoke('presentations:section', id, section),
    finish: id => ipcRenderer.invoke('presentations:finish', id),
    cancel: id => ipcRenderer.invoke('presentations:cancel', id),
    assess: (id, value) => ipcRenderer.invoke('presentations:assess', id, value),
    removeTake: id => ipcRenderer.invoke('presentations:remove-take', id),
    export: (id, format) => ipcRenderer.invoke('presentations:export', id, format),
    onFinishRequest: callback => {
      const listener = () => callback();
      ipcRenderer.on('presentations:finish-request', listener);
      return () => ipcRenderer.removeListener('presentations:finish-request', listener);
    },
  },
  planner: {
    read: () => ipcRenderer.invoke('planner:read'),
    saveCourse: (id, value) => ipcRenderer.invoke('planner:save-course', id, value),
    removeCourse: id => ipcRenderer.invoke('planner:remove-course', id),
    saveTask: (id, value) => ipcRenderer.invoke('planner:save-task', id, value),
    completeTask: (id, completed) => ipcRenderer.invoke('planner:complete-task', id, completed),
    removeTask: id => ipcRenderer.invoke('planner:remove-task', id),
    saveGoal: (week, target) => ipcRenderer.invoke('planner:save-goal', week, target),
    materials: () => ipcRenderer.invoke('planner:materials'),
  },
  bibliography: {
    list: () => ipcRenderer.invoke('bibliography:list'),
    create: title => ipcRenderer.invoke('bibliography:create', title),
    open: id => ipcRenderer.invoke('bibliography:open', id),
    configure: (id, value) => ipcRenderer.invoke('bibliography:configure', id, value),
    references: (id, filter) => ipcRenderer.invoke('bibliography:references', id, filter),
    reference: (id, recordId) => ipcRenderer.invoke('bibliography:reference', id, recordId),
    update: (id, recordId, value) => ipcRenderer.invoke('bibliography:update', id, recordId, value),
    importReferences: (id, origin) => ipcRenderer.invoke('bibliography:import', id, origin),
    openSource: (id, recordId) => ipcRenderer.invoke('bibliography:source', id, recordId),
    export: (id, format) => ipcRenderer.invoke('bibliography:export', id, format),
  },
  transcriptionList: () => ipcRenderer.invoke('transcription:list'),
  transcriptionOpen: id => ipcRenderer.invoke('transcription:open', id),
  transcriptionImport: () => ipcRenderer.invoke('transcription:import'),
  transcriptionStart: (id, language, quality) => ipcRenderer.invoke('transcription:start', id, language, quality),
  transcriptionRetryRange: (id, language, quality, range) => ipcRenderer.invoke('transcription:retry-range', id, language, quality, range),
  transcriptionApplyRange: (id, suggestion) => ipcRenderer.invoke('transcription:apply-range', id, suggestion),
  transcriptionOrganize: (id, course) => ipcRenderer.invoke('transcription:organize', id, course),
  transcriptionSearch: (query, course) => ipcRenderer.invoke('transcription:search', query, course),
  transcriptionGlossary: id => ipcRenderer.invoke('transcription:glossary', id),
  transcriptionSaveGlossary: (id, text) => ipcRenderer.invoke('transcription:save-glossary', id, text),
  transcriptionMakeCard: (id, markId, value) => ipcRenderer.invoke('transcription:make-card', id, markId, value),
  transcriptionCards: () => ipcRenderer.invoke('transcription:cards'),
  transcriptionReviewCard: (id, grade) => ipcRenderer.invoke('transcription:review-card', id, grade),
  transcriptionRemoveCard: id => ipcRenderer.invoke('transcription:remove-card', id),
  transcriptionExportAnki: () => ipcRenderer.invoke('transcription:export-anki'),
  transcriptionCancel: id => ipcRenderer.invoke('transcription:cancel', id),
  transcriptionEdit: (id, index, value) => ipcRenderer.invoke('transcription:edit', id, index, value),
  transcriptionSaveMark: (id, markId, value) => ipcRenderer.invoke('transcription:save-mark', id, markId, value),
  transcriptionRemoveMark: (id, markId) => ipcRenderer.invoke('transcription:remove-mark', id, markId),
  transcriptionExport: (id, format) => ipcRenderer.invoke('transcription:export', id, format),
  transcriptionRemove: id => ipcRenderer.invoke('transcription:remove', id),
  onTranscriptionProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('transcription:progress', listener);
    return () => ipcRenderer.removeListener('transcription:progress', listener);
  },
  updateStatus: () => ipcRenderer.invoke('updates:status'),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  downloadUpdate: () => ipcRenderer.invoke('updates:download'),
  installUpdate: () => ipcRenderer.invoke('updates:install'),
  onUpdateState: callback => { const listener = (_event, state) => callback(state); ipcRenderer.on('updates:state', listener); return () => ipcRenderer.removeListener('updates:state', listener); },
  readBookContent: id => ipcRenderer.invoke('book:content', id),
  saveSearchablePdf: (id, bytes) => ipcRenderer.invoke('ocr:save-pdf', id, bytes),
  describeBook: (id, value) => ipcRenderer.invoke('library:describe', id, value),
  searchStatus: () => ipcRenderer.invoke('search:status'),
  searchFingerprint: id => ipcRenderer.invoke('search:fingerprint', id),
  saveSearchIndex: (id, units, fingerprint) => ipcRenderer.invoke('search:save', id, units, fingerprint),
  searchLibrary: (query, scope) => ipcRenderer.invoke('search:query', query, scope),
  workspaceStorage: () => ipcRenderer.invoke('workspace:storage'),
  workspaceDeleteCopy: key => ipcRenderer.invoke('workspace:delete-copy', key),
  workspaceImportFiles: () => ipcRenderer.invoke('workspace:import-files'),
  workspaceImportFolder: () => ipcRenderer.invoke('workspace:import-folder'),
  workspaceMove: removeOld => ipcRenderer.invoke('workspace:move', removeOld),
  workspaceBackup: (prefs, options) => ipcRenderer.invoke('workspace:backup', prefs, options),
  workspacePreviewRestore: () => ipcRenderer.invoke('workspace:preview-restore'),
  workspaceRestore: id => ipcRenderer.invoke('workspace:restore', id),
  workspaceCancel: () => ipcRenderer.invoke('workspace:cancel'),
  onWorkspaceProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('workspace:progress', listener); return () => ipcRenderer.removeListener('workspace:progress', listener); },
  playerList: () => ipcRenderer.invoke('player:list'),
  playerChoose: () => ipcRenderer.invoke('player:choose'),
  playerOpenExport: (directory, index) => ipcRenderer.invoke('player:open-export', directory, index),
  playerListExports: id => ipcRenderer.invoke('player:list-exports', id),
  playerLinkExport: id => ipcRenderer.invoke('player:link-export', id),
  playerProgress: (id, position, rate) => ipcRenderer.invoke('player:progress', id, position, rate),
  playerCheckpoint: (id, position, rate) => ipcRenderer.sendSync('player:checkpoint', id, position, rate),
  playerBookmark: (id, value) => ipcRenderer.invoke('player:bookmark', id, value),
  playerRemoveBookmark: (id, mark) => ipcRenderer.invoke('player:remove-bookmark', id, mark),
  playerSleep: minutes => ipcRenderer.invoke('player:sleep', minutes),
  mediaKeys: (source, active) => ipcRenderer.invoke('player:media-keys', source, active),
  onMediaToggle: callback => {
    const listener = (_event, source) => callback(source);
    ipcRenderer.on('player:media-toggle', listener);
    return () => ipcRenderer.removeListener('player:media-toggle', listener);
  },
  onPlayerSleep: callback => { const listener = () => callback(); ipcRenderer.on('player:sleep-ended', listener); return () => ipcRenderer.removeListener('player:sleep-ended', listener); },
  openFloatingPlayer: state => ipcRenderer.invoke('player:floating-open', state),
  closeFloatingPlayer: source => ipcRenderer.invoke('player:floating-close', source),
  updateFloatingPlayer: state => ipcRenderer.invoke('player:floating-state', state),
  onFloatingPlayerCommand: callback => {
    const listener = (_event, source, command, position) => callback(source, command, position);
    ipcRenderer.on('player:floating-command', listener);
    return () => ipcRenderer.removeListener('player:floating-command', listener);
  },
  onFloatingPlayerSource: callback => {
    const listener = (_event, source) => callback(source);
    ipcRenderer.on('player:floating-source', listener);
    return () => ipcRenderer.removeListener('player:floating-source', listener);
  },
  onFloatingPlayerExpand: callback => {
    const listener = (_event, source) => callback(source);
    ipcRenderer.on('player:floating-expand', listener);
    return () => ipcRenderer.removeListener('player:floating-expand', listener);
  },
  chooseBook: mode => ipcRenderer.invoke('book:choose', mode),
  importExisting: id => ipcRenderer.invoke('book:import-existing', id),
  showBooksFolder: () => ipcRenderer.invoke('library:show-books'),
  onExternalOpenRequest: callback => { const listener = () => callback(); ipcRenderer.on('book:external-request', listener); return () => ipcRenderer.removeListener('book:external-request', listener); },
  openDroppedBook: file => ipcRenderer.invoke('book:drop', webUtils.getPathForFile(file)),
  choosePdf: () => ipcRenderer.invoke('book:choose'),
  openDroppedPdf: file => ipcRenderer.invoke('book:drop', webUtils.getPathForFile(file)),
  openRecent: id => ipcRenderer.invoke('book:recent', id),
  listRecent: () => ipcRenderer.invoke('library:list'),
  organizeBook: (id, value) => ipcRenderer.invoke('library:organize', id, value),
  readStudy: id => ipcRenderer.invoke('study:read', id),
  saveStudySettings: value => ipcRenderer.invoke('study:settings', value),
  recordReading: (id, seconds, sample, session) => ipcRenderer.invoke('study:tick', id, seconds, sample, session),
  recordListening: (id, value) => ipcRenderer.invoke('study:listen', id, value),
  saveGlossary: (id, value) => ipcRenderer.invoke('study:glossary', id, value),
  narrationPosition: (id, value) => ipcRenderer.invoke('speech:position', id, value),
  narrationCheckpoint: (id, value) => ipcRenderer.sendSync('speech:checkpoint', id, value),
  narrationSleep: minutes => ipcRenderer.invoke('speech:sleep', minutes),
  onNarrationSleep: callback => {
    const listener = () => callback();
    ipcRenderer.on('speech:sleep-ended', listener);
    return () => ipcRenderer.removeListener('speech:sleep-ended', listener);
  },
  saveCrop: (id, value) => ipcRenderer.invoke('study:crop', id, value),
  saveCard: (id, value) => ipcRenderer.invoke('study:card', id, value),
  removeCard: (id, cardId) => ipcRenderer.invoke('study:remove-card', id, cardId),
  reviewCard: (id, cardId, grade) => ipcRenderer.invoke('study:review', id, cardId, grade),
  lookup: value => ipcRenderer.invoke('study:lookup', value),
  exportNotes: (id, format) => ipcRenderer.invoke('study:export-notes', id, format),
  showExport: value => ipcRenderer.invoke('study:show-export', value),
  openLookupSource: value => ipcRenderer.invoke('study:open-source', value),
  exportAudiobook: (id, chapters, voice) => ipcRenderer.invoke('audiobook:export', id, chapters, voice),
  cancelAudiobook: () => ipcRenderer.invoke('audiobook:cancel'),
  onAudiobookProgress: callback => { const listener = (_event, value) => callback(value); ipcRenderer.on('audiobook:progress', listener); return () => ipcRenderer.removeListener('audiobook:progress', listener); },
  saveProgress: (id, page, totalPages) => ipcRenderer.invoke('library:progress', id, page, totalPages),
  saveEpubProgress: (id, location) => ipcRenderer.invoke('library:epub-progress', id, location),
  saveBookMetadata: (id, metadata) => ipcRenderer.invoke('library:metadata', id, metadata),
  removeRecent: id => ipcRenderer.invoke('library:remove', id),
  readNotebook: id => ipcRenderer.invoke('notebook:read', id),
  saveAnnotation: (id, annotation) => ipcRenderer.invoke('notebook:annotation', id, annotation),
  removeAnnotation: (id, annotationId) => ipcRenderer.invoke('notebook:remove-annotation', id, annotationId),
  saveBookmark: (id, bookmark) => ipcRenderer.invoke('notebook:bookmark', id, bookmark),
  removeBookmark: (id, bookmarkId) => ipcRenderer.invoke('notebook:remove-bookmark', id, bookmarkId),
  recognizePage: (id, page, image, jobId) => ipcRenderer.invoke('ocr:recognize', id, page, image, jobId),
  recognizeArea: (id, page, image, jobId) => ipcRenderer.invoke('ocr:area', id, page, image, jobId),
  savePageReview: (id, page, update) => ipcRenderer.invoke('notebook:review-page', id, page, update),
  cancelOcr: () => ipcRenderer.invoke('ocr:cancel'),
  onOcrProgress: callback => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('ocr:progress', listener);
    return () => ipcRenderer.removeListener('ocr:progress', listener);
  },
  speechVoices: () => ipcRenderer.invoke('speech:voices'),
  synthesizeSpeech: (id, text, voice) => ipcRenderer.invoke('speech:synthesize', id, text, voice),
  cancelSpeech: () => ipcRenderer.invoke('speech:cancel'),
  onOpenRequest: callback => {
    const listener = () => callback();
    ipcRenderer.on('pdf:open-request', listener);
    return () => ipcRenderer.removeListener('pdf:open-request', listener);
  },
});
