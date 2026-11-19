import { useEffect } from 'react';

import { soundLabel, startMuted } from '../lib/sound.ts';
import styles from './LightboxSound.module.css';

const ICON_OFF =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><line x1="22" x2="16" y1="9" y2="15"/><line x1="16" x2="22" y1="9" y2="15"/></svg>';
const ICON_ON =
  '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H2v6h4l5 4V5Z"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>';

/**
 * While the kit's Lightbox is open, the clip on show starts muted and plays
 * by itself, and a "Turn sound on" button sits over it (the clip's own
 * controls have a speaker too). The kit's Lightbox takes no children, so the
 * button is put into its dialog by hand: there, the Lightbox's own keys
 * (arrows, Escape) still reach it from the button. A clip moved away from is
 * paused.
 */
export function LightboxSound({ isOpen }: { isOpen: boolean }) {
  useEffect(() => {
    if (!isOpen) return;
    let video: HTMLVideoElement | null = null;
    let button: HTMLButtonElement | null = null;
    const show = () => {
      if (!button || !video) return;
      button.innerHTML = `${video.muted ? ICON_OFF : ICON_ON}<span>${soundLabel(video.muted)}</span>`;
      button.setAttribute('aria-pressed', String(!video.muted));
    };
    const drop = () => {
      video?.removeEventListener('volumechange', show);
      button?.remove();
      button = null;
    };
    const look = () => {
      const page = document.querySelector('dialog[open] [data-lightbox-page][data-current]');
      const dialog = page?.closest('dialog') ?? null;
      const now = page?.querySelector('video') ?? null;
      if (now === video) return;
      drop();
      video?.pause();
      video = now;
      if (!video || !dialog) return;
      startMuted(video);
      button = document.createElement('button');
      button.type = 'button';
      button.className = styles.sound!;
      button.addEventListener('click', () => {
        if (!video) return;
        video.muted = !video.muted;
        if (!video.muted && video.paused) void video.play().catch(() => {});
      });
      video.addEventListener('volumechange', show);
      show();
      dialog.appendChild(button);
    };
    look();
    const watch = new MutationObserver(look);
    watch.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-current', 'open'] });
    return () => {
      watch.disconnect();
      drop();
      video = null;
    };
  }, [isOpen]);
  return null;
}
