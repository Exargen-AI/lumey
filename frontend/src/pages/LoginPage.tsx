import { useState } from 'react';
import { Mail, Lock, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

export function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-gray-50 dark:bg-obsidian-deep px-4 py-10 overflow-hidden">
      {/* Subtle violet ambient glows — top-left and bottom-right.
          They give the page depth without distracting from the form. */}
      <div className="pointer-events-none absolute -top-40 -left-40 w-[28rem] h-[28rem] rounded-full bg-brand-500/15 dark:bg-brand-500/[0.18] blur-3xl" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 w-[28rem] h-[28rem] rounded-full bg-fuchsia-500/10 dark:bg-fuchsia-500/[0.10] blur-3xl" />
      {/* Grid texture — barely-there in dark, invisible in light */}
      <div
        className="pointer-events-none absolute inset-0 opacity-0 dark:opacity-[0.04]"
        style={{
          backgroundImage:
            'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
        }}
      />

      <div className="relative w-full max-w-md animate-fade-in-up">
        {/* Brand mark + heading */}
        <div className="text-center mb-7">
          <div className="inline-flex w-14 h-14 rounded-2xl overflow-hidden ring-1 ring-black/5 dark:ring-white/10 shadow-lift dark:shadow-lift-dark mb-4">
            <img src="/logo.jpeg" alt="Exargen" className="w-full h-full object-cover" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900 dark:text-obsidian-fg">
            Welcome back
          </h1>
          <p className="text-sm text-gray-500 dark:text-obsidian-muted mt-1.5">
            Sign in to your Command Center
          </p>
        </div>

        {/* Card */}
        <div className={cn(
          'rounded-2xl p-7',
          'bg-white border border-gray-200 dark:bg-obsidian-panel dark:border-obsidian-border',
          'shadow-lift dark:shadow-pop-dark',
        )}>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && (
              <div
                role="alert"
                className={cn(
                  'flex items-start gap-2.5 rounded-lg px-3.5 py-3 text-sm animate-fade-in',
                  'bg-rose-50 border border-rose-200 text-rose-700',
                  'dark:bg-rose-500/[0.08] dark:border-rose-500/30 dark:text-rose-300',
                )}
              >
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <span className="leading-snug">{error}</span>
              </div>
            )}

            <Field
              label="Email"
              icon={<Mail size={15} />}
              type="email"
              value={email}
              onChange={setEmail}
              placeholder="you@exargen.in"
              autoComplete="email"
              required
            />

            <Field
              label="Password"
              icon={<Lock size={15} />}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={setPassword}
              placeholder="Enter your password"
              autoComplete="current-password"
              required
              trailing={
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="p-1 rounded text-gray-400 hover:text-gray-600 dark:text-obsidian-faded dark:hover:text-obsidian-fg transition-colors"
                  tabIndex={-1}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              }
            />

            <Button type="submit" loading={loading} fullWidth size="lg" className="mt-2">
              {loading ? 'Signing in…' : 'Sign In'}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-gray-400 dark:text-obsidian-faded">
          Trouble signing in? Contact your workspace admin.
        </p>
      </div>
    </div>
  );
}

// ─── Reusable input field with leading icon + optional trailing slot ───

interface FieldProps {
  label: string;
  icon: React.ReactNode;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoComplete?: string;
  required?: boolean;
  trailing?: React.ReactNode;
}

function Field({ label, icon, type, value, onChange, placeholder, autoComplete, required, trailing }: FieldProps) {
  return (
    <div>
      <label className="block text-[11px] font-medium uppercase tracking-[0.08em] text-gray-500 dark:text-obsidian-muted mb-1.5">
        {label}
      </label>
      <div className={cn(
        'group flex items-center gap-2 px-3 h-10 rounded-lg transition-colors',
        'bg-white border border-gray-200 hover:border-gray-300',
        'dark:bg-obsidian-raised dark:border-obsidian-border dark:hover:border-obsidian-border-strong',
        'focus-within:border-brand-500 dark:focus-within:border-brand-400',
      )}>
        <span className="text-gray-400 dark:text-obsidian-faded shrink-0 group-focus-within:text-brand-500 dark:group-focus-within:text-brand-400 transition-colors">
          {icon}
        </span>
        <input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          placeholder={placeholder}
          autoComplete={autoComplete}
          className="flex-1 bg-transparent border-0 outline-none text-sm text-gray-900 dark:text-obsidian-fg placeholder:text-gray-400 dark:placeholder:text-obsidian-faded p-0 focus:ring-0"
          style={{ boxShadow: 'none' }}
        />
        {trailing}
      </div>
    </div>
  );
}
