import { X } from 'lucide-react';
import { Dialog, Heading, Modal, ModalOverlay } from 'react-aria-components';

import { Button } from './Button.tsx';
import styles from './Lightbox.module.css';

export type LightboxProps = {
  src: string | null;
  /** A clip: shown with the player's own controls instead of as a picture. */
  video?: boolean | undefined;
  alt: string;
  title: string;
  onClose: () => void;
};

/** Full-size view of one image or clip. Escape or a click outside closes it. */
export function Lightbox({ src, video = false, alt, title, onClose }: LightboxProps) {
  return (
    <ModalOverlay
      className={styles.overlay}
      isOpen={src !== null}
      isDismissable
      onOpenChange={(open) => !open && onClose()}
    >
      <Modal className={styles.modal}>
        <Dialog className={styles.dialog}>
          <div className={styles.bar}>
            <Heading slot="title" className={styles.title}>
              {title}
            </Heading>
            <Button variant="ghost" size="sm" icon={<X size={14} />} aria-label="Close" onPress={onClose} />
          </div>
          {src && video ? (
            <video className={styles.image} src={src} aria-label={alt} controls autoPlay playsInline />
          ) : src ? (
            <img className={styles.image} src={src} alt={alt} />
          ) : null}
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
