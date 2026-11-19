import type { ReactNode } from 'react';
import { Link } from 'react-aria-components';

import styles from './Text.module.css';

export type TextProps = {
  tone?: 'default' | 'secondary' | 'muted' | undefined;
  size?: 'sm' | 'md' | undefined;
  as?: 'span' | 'p' | undefined;
  children?: ReactNode | undefined;
  className?: string | undefined;
};

export function Text({
  tone = 'default',
  size = 'md',
  as: Tag = 'span',
  children,
  className,
}: TextProps) {
  return (
    <Tag
      className={[styles.text, styles[tone], styles[size], className]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </Tag>
  );
}

export type TextLinkProps = {
  href: string;
  children?: ReactNode | undefined;
};

/** A link inside the app. Never a new window: the home screen frames the app without popups. */
export function TextLink({ href, children }: TextLinkProps) {
  return (
    <Link href={href} className={styles.link}>
      {children}
    </Link>
  );
}
