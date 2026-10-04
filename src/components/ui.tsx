import type { ReactNode } from 'react';

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span className={`material-symbols-outlined ${className}`} aria-hidden="true">{name}</span>;
}

export function formatDate(value?: string | null, withTime = true) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : date.toLocaleString(undefined, withTime
      ? { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }
      : { month: 'short', day: 'numeric', year: 'numeric' });
}

export function Severity({ value }: { value: string }) {
  return <span className={`severity ${value.toLowerCase()}`}>{value}</span>;
}

export function Status({ value }: { value: string }) {
  return <span className={`status-badge ${value.toLowerCase()}`}>{value}</span>;
}

export function Button({
  children, className = '', icon, ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { icon?: string }) {
  return <button className={`button ${className}`} {...props}>{icon && <Icon name={icon} />}{children}</button>;
}

export function StateBox({
  icon = 'inbox', title, children, action,
}: { icon?: string; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state-box">
      <Icon name={icon} />
      <strong>{title}</strong>
      {children && <p>{children}</p>}
      {action && <div className="state-actions">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, retry }: { message: string; retry: () => void }) {
  return (
    <div className="state-box error" role="alert">
      <Icon name="error" />
      <strong>We couldn't load this data</strong>
      <p>{message}</p>
      <div className="state-actions"><Button onClick={retry} icon="refresh">Try again</Button></div>
    </div>
  );
}

export function SkeletonRows({ count = 4 }: { count?: number }) {
  return <div className="skeleton-stack" aria-label="Loading" role="status">{Array.from({ length: count }, (_, index) => <div className="skeleton" key={index} />)}</div>;
}

export function VitalityDogAvatar({
  size = 40,
  status,
  className = '',
}: {
  size?: number;
  status?: 'healthy' | 'failing' | 'online' | 'alert';
  className?: string;
}) {
  return (
    <div className={`vitality-avatar-wrap ${className}`} style={{ width: size, height: size }}>
      <img
        src="/assets/vitality_dog_circle_avatar.png"
        alt="Stanley the Vitality Dog Mascot"
        className="vitality-avatar-img"
      />
      {status && (
        <span
          className={`vitality-avatar-dot ${status}`}
          title={`Stanley status: ${status}`}
        />
      )}
    </div>
  );
}

export function VitalityMascotBanner({
  badge = 'Vitality SRE Protection',
  title,
  description,
  accent = 'magenta',
  children,
}: {
  badge?: string;
  title: string;
  description: string;
  accent?: 'magenta' | 'dark' | 'soft';
  children?: ReactNode;
}) {
  return (
    <aside className={`vitality-mascot-banner ${accent}`} aria-label={title}>
      <div className="vitality-banner-content">
        <div className="vitality-banner-badge">
          <span className="vitality-heart-icon">♥</span>
          <span>{badge}</span>
        </div>
        <h2 className="vitality-banner-title">{title}</h2>
        <p className="vitality-banner-desc">{description}</p>
        {children && <div className="vitality-banner-actions">{children}</div>}
      </div>
      <div className="vitality-banner-mascot">
        <img
          src="/assets/vitality_dog_transparent.png"
          alt="Stanley the Vitality Dachshund with dumbbells and water bottle"
          className="vitality-banner-dog"
        />
      </div>
    </aside>
  );
}

export function PageIntro({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-intro">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {children}
    </div>
  );
}