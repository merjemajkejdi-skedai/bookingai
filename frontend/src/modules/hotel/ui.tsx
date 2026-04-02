import { type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes, useEffect } from 'react';
import { X } from 'lucide-react';
import clsx from 'clsx';

// --- Button -----------------------------------------------------------------
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'ghost' | 'danger' | 'outline';
  size?: 'sm' | 'md';
}
export function Button({ variant = 'primary', size = 'md', className, children, ...p }: ButtonProps) {
  return (
    <button
      className={clsx(
        'inline-flex items-center gap-1.5 font-medium rounded-lg transition-all',
        size === 'sm' ? 'px-3 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        variant === 'primary' && 'bg-brand-500 text-white hover:bg-brand-600 active:bg-brand-700',
        variant === 'ghost'   && 'text-slate-600 hover:bg-slate-100',
        variant === 'danger'  && 'bg-red-50 text-red-600 hover:bg-red-100',
        variant === 'outline' && 'border border-slate-200 text-slate-700 hover:bg-slate-50',
        'disabled:opacity-40 disabled:cursor-not-allowed',
        className
      )}
      {...p}
    >
      {children}
    </button>
  );
}

// --- Input ------------------------------------------------------------------
interface InputProps extends InputHTMLAttributes<HTMLInputElement> { label?: string; }
export function Input({ label, className, ...p }: InputProps) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="font-medium text-slate-700">{label}</span>}
      <input
        className={clsx(
          'rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white',
          'focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400',
          'disabled:bg-slate-50 disabled:text-slate-400',
          className
        )}
        {...p}
      />
    </label>
  );
}

// --- Textarea ---------------------------------------------------------------
export function Textarea({ label, className, ...p }: any) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="font-medium text-slate-700">{label}</span>}
      <textarea
        rows={3}
        className={clsx(
          'rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white resize-none',
          'focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400',
          className
        )}
        {...p}
      />
    </label>
  );
}

// --- Select -----------------------------------------------------------------
export function Select({ label, className, children, ...p }: any) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      {label && <span className="font-medium text-slate-700">{label}</span>}
      <select
        className={clsx(
          'rounded-lg border border-slate-200 px-3 py-2 text-sm bg-white',
          'focus:outline-none focus:ring-2 focus:ring-brand-400/40 focus:border-brand-400',
          className
        )}
        {...p}
      >
        {children}
      </select>
    </label>
  );
}

// --- Modal ------------------------------------------------------------------
interface ModalProps { title: string; onClose: () => void; children: ReactNode; wide?: boolean; }
export function Modal({ title, onClose, children, wide }: ModalProps) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-900/40 backdrop-blur-sm" onClick={onClose} />
      <div className={clsx(
        'relative bg-white rounded-2xl shadow-2xl w-full flex flex-col max-h-[90vh]',
        wide ? 'max-w-2xl' : 'max-w-md'
      )}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold">{title}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100 text-slate-400">
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-6 flex-1">{children}</div>
      </div>
    </div>
  );
}

// --- Spinner ----------------------------------------------------------------
export function Spinner() {
  return (
    <div className="flex items-center justify-center h-32">
      <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
