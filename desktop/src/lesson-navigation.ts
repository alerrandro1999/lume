import type { LessonSource } from './types';

export const lessonSourceEvent = 'lume-open-lesson-source';

export function openLessonSource(source: LessonSource) {
  window.dispatchEvent(new CustomEvent<LessonSource>(lessonSourceEvent, { detail: source }));
}
