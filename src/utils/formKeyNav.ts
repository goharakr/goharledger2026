import type { KeyboardEvent } from 'react';

// Arrow keys move between boxes instead of needing the mouse - Down/Right go
// to the next box, Up/Left to the previous one, scoped to the nearest
// ancestor carrying `data-form-nav` (so separate forms/rows on the same page
// don't jump into each other). Enter does the same going forward, and once
// it reaches the very last box, calls onEnterAtEnd (e.g. save, or add a new
// row) instead of doing nothing.
export function handleFormKeyNav(e: KeyboardEvent, onEnterAtEnd?: () => void) {
  const forward = e.key === 'Enter' || e.key === 'ArrowDown' || e.key === 'ArrowRight';
  const backward = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
  if (!forward && !backward) return;

  const target = e.target as HTMLElement;
  const scope = target.closest('[data-form-nav]');
  if (!scope) return;
  const inputs = Array.from(scope.querySelectorAll('input, select, textarea')) as HTMLElement[];
  const currentIdx = inputs.indexOf(target);
  if (currentIdx === -1) return;

  e.preventDefault();
  if (forward) {
    if (currentIdx < inputs.length - 1) {
      inputs[currentIdx + 1].focus();
    } else if (e.key === 'Enter') {
      onEnterAtEnd?.();
    }
  } else if (currentIdx > 0) {
    inputs[currentIdx - 1].focus();
  }
}
