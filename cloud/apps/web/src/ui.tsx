import clsx from 'clsx';
import { Check, Copy, Loader2, X } from 'lucide-react';
import {
  ButtonHTMLAttributes,
  createContext,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { toast } from 'sonner';
import { ApiError } from './api';

export function errorText(error: unknown): string {
  if (error instanceof ApiError || error instanceof Error) return error.message;
  return 'Đã có lỗi xảy ra';
}

export const notifyError = (error: unknown) => toast.error(errorText(error));

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger' | 'danger-outline';

export function Button({
  variant = 'primary',
  size = 'md',
  busy,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: 'sm' | 'md' | 'lg'; busy?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      disabled={disabled || busy}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-55',
        size === 'sm' && 'h-8 px-3 text-[13px]',
        size === 'md' && 'h-10 px-4 text-sm',
        size === 'lg' && 'h-12 px-6 text-[15px]',
        variant === 'primary' && 'bg-brand-strong text-white hover:bg-brand-strong/90 soft-shadow',
        variant === 'outline' && 'border border-line bg-card text-ink hover:bg-raised',
        variant === 'ghost' && 'text-soft hover:bg-raised hover:text-ink',
        variant === 'danger' && 'bg-bad text-white hover:bg-bad/90 dark:text-[#2a0b11]',
        variant === 'danger-outline' && 'border border-bad/50 bg-card text-bad hover:bg-bad-soft',
        className,
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={clsx('rounded-2xl border border-line bg-card soft-shadow', className)}>{children}</section>;
}

export function CardTitle({ title, hint, action, className }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx('flex flex-wrap items-center justify-between gap-3 px-5 pt-5 pb-3', className)}>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-soft">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, hint, action, back }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; back?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        {back}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
          {hint && <p className="mt-1 text-sm text-soft">{hint}</p>}
        </div>
      </div>
      {action && <div className="flex flex-wrap items-center gap-2">{action}</div>}
    </header>
  );
}

export type Tone = 'ok' | 'bad' | 'warn' | 'info' | 'neutral' | 'solid-ok';

export function Badge({ tone = 'neutral', className, children, title }: { tone?: Tone; className?: string; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={clsx(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'solid-ok' && 'bg-emerald-400 text-emerald-950',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'info' && 'bg-brand-soft text-brand-strong dark:text-brand',
        tone === 'neutral' && 'bg-raised text-soft',
        className,
      )}
    >
      {children}
    </span>
  );
}

const fieldBase =
  'rounded-xl border border-line bg-card px-3 text-sm text-ink outline-none transition-shadow placeholder:text-faint focus:border-brand focus:ring-3 focus:ring-brand/20 disabled:opacity-60';

// Full width unless the caller sets a width: two width classes would be decided by stylesheet order
const fieldClass = (className?: string) => clsx(fieldBase, !/(^|\s)w-/.test(className ?? '') && 'w-full', className);

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={fieldClass(clsx('h-10', className))} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={fieldClass(clsx('py-2', className))} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={fieldClass(clsx('h-10 pr-8', className))}>
      {children}
    </select>
  );
}

export function Field({ label, hint, children, className }: { label: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-semibold">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-soft">{hint}</span>}
    </label>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={clsx(
        'relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
        checked ? 'bg-brand-strong' : 'bg-line',
      )}
    >
      <span className={clsx('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', checked ? 'left-[22px]' : 'left-0.5')} />
    </button>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange, className }: { tabs: Array<{ id: T; label: ReactNode; count?: number; hidden?: boolean }>; value: T; onChange: (id: T) => void; className?: string }) {
  return (
    <div role="tablist" className={clsx('flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line [scrollbar-width:none]', className)}>
      {tabs
        .filter((tab) => !tab.hidden)
        .map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={value === tab.id}
            onClick={() => onChange(tab.id)}
            className={clsx(
              '-mb-px flex items-center gap-2 border-b-2 px-3.5 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors',
              value === tab.id ? 'border-brand-strong text-brand-strong dark:border-brand dark:text-brand' : 'border-transparent text-soft hover:text-ink',
            )}
          >
            {tab.label}
            {tab.count !== undefined && <span className="rounded-full bg-raised px-2 py-0.5 text-xs text-soft">{tab.count}</span>}
          </button>
        ))}
    </div>
  );
}

export function Pills<T extends string>({ options, value, onChange }: { options: Array<{ id: T; label: ReactNode; icon?: ReactNode }>; value: T; onChange: (id: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          className={clsx(
            'inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-[13px] font-semibold transition-colors',
            value === option.id ? 'border-brand-strong bg-brand-strong text-white' : 'border-line bg-card text-ink hover:bg-raised',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function Modal({ open, onClose, title, hint, children, footer, wide }: { open: boolean; onClose: () => void; title: ReactNode; hint?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  if (!open) return null;
  return (
    <dialog
      ref={ref}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      className={clsx('w-[calc(100vw-2rem)] rounded-2xl border border-line bg-card p-0 text-ink shadow-2xl', wide ? 'max-w-3xl' : 'max-w-lg')}
    >
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-lg font-bold">{title}</h2>
          {hint && <p className="mt-0.5 text-sm text-soft">{hint}</p>}
        </div>
        <button type="button" aria-label="Đóng" onClick={onClose} className="rounded-lg p-1 text-soft hover:bg-raised">
          <X className="size-5" />
        </button>
      </div>
      <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
      {footer && <div className="flex flex-wrap justify-end gap-2 border-t border-line px-5 py-4">{footer}</div>}
    </dialog>
  );
}

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirm?: string;
  danger?: boolean;
}

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<(ConfirmOptions & { resolve: (value: boolean) => void }) | null>(null);
  const close = (value: boolean) => {
    state?.resolve(value);
    setState(null);
  };
  return (
    <ConfirmContext.Provider value={(options) => new Promise((resolve) => setState({ ...options, resolve }))}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title}
        footer={
          <>
            <Button variant="outline" onClick={() => close(false)}>
              Hủy
            </Button>
            <Button variant={state?.danger ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirm ?? 'Xác nhận'}
            </Button>
          </>
        }
      >
        <div className="text-sm text-soft">{state?.message}</div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function Empty({ icon, title, hint, action }: { icon?: ReactNode; title: string; hint?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      {icon && <div className="mb-3 text-soft [&_svg]:size-10 [&_svg]:stroke-[1.4]">{icon}</div>}
      <p className="font-bold">{title}</p>
      {hint && <p className="mt-1 max-w-md text-sm text-soft">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Loading({ label = 'Đang tải…' }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-16 text-sm text-soft">
      <Loader2 className="size-5 animate-spin" /> {label}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  return <Notice tone="bad">{errorText(error)}</Notice>;
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'warn' | 'bad' | 'ok'; children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'rounded-xl px-4 py-3 text-sm',
        tone === 'info' && 'bg-brand-soft text-ink',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'bad' && 'bg-bad-soft text-bad',
        tone === 'ok' && 'bg-ok-soft text-ok',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CopyButton({ value, label = 'Sao chép', size = 'sm' }: { value: string; label?: string; size?: 'sm' | 'md' }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="outline"
      size={size}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
        } catch {
          // Not an HTTPS page: the old way still works
          const area = document.createElement('textarea');
          area.value = value;
          document.body.appendChild(area);
          area.select();
          document.execCommand('copy');
          area.remove();
        }
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
      {done ? 'Đã chép' : label}
    </Button>
  );
}

export function Progress({ value, tone = 'brand', className }: { value: number; tone?: 'brand' | 'ok' | 'warn' | 'bad'; className?: string }) {
  return (
    <div className={clsx('h-1.5 w-full overflow-hidden rounded-full bg-line', className)}>
      <div
        className={clsx('h-full rounded-full transition-all', tone === 'brand' && 'bg-brand', tone === 'ok' && 'bg-ok', tone === 'warn' && 'bg-warn', tone === 'bad' && 'bg-bad')}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </div>
  );
}

export const th = 'px-4 py-2.5 text-left text-xs font-semibold text-soft whitespace-nowrap';
export const td = 'px-4 py-3 text-sm align-middle';
export const trow = 'border-t border-line transition-colors hover:bg-raised/60';

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={clsx('overflow-x-auto', className)}>
      <table className="w-full min-w-[640px] border-collapse">{children}</table>
    </div>
  );
}
