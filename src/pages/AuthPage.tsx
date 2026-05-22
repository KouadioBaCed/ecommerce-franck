import { useState } from 'react';
import {
  ShoppingBag,
  Eye,
  EyeOff,
  Mail,
  Lock,
  Loader2,
  AlertCircle,
  ArrowRight,
  Sparkles,
  ShieldCheck,
  Star,
  CheckCircle,
  Store,
  TrendingUp,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';

interface AuthPageProps {
  navigate: (path: string) => void;
}

const BENEFITS = [
  { icon: Store,        label: 'Créez votre boutique en 2 minutes' },
  { icon: TrendingUp,   label: 'Aucune commission cachée' },
  { icon: ShieldCheck,  label: 'Vendeurs vérifiés et sécurisés' },
  { icon: Sparkles,     label: 'Recevez vos commandes sur WhatsApp' },
];

export function AuthPage({ navigate }: AuthPageProps) {
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (mode === 'login') {
      const { error } = await signIn(email, password);
      if (error) {
        setError('Email ou mot de passe incorrect');
      } else {
        navigate('/admin');
      }
    } else {
      if (password.length < 6) {
        setError('Le mot de passe doit contenir au moins 6 caractères');
        setLoading(false);
        return;
      }
      const { error } = await signUp(email, password);
      if (error) {
        const msg = (error as { message?: string }).message || '';
        if (msg.includes('already registered')) {
          setError('Cet email est déjà utilisé');
        } else {
          setError('Une erreur est survenue. Réessayez.');
        }
      } else {
        navigate('/admin');
      }
    }
    setLoading(false);
  }

  return (
    <div className="min-h-screen bg-surface-alt grid lg:grid-cols-2">
      {/* Brand panel */}
      <aside className="relative hidden lg:flex flex-col bg-ink text-white p-12 overflow-hidden">
        <div className="absolute inset-0 bg-mesh opacity-30" />
        <div className="absolute -top-24 -left-24 w-96 h-96 bg-brand-500/30 rounded-full blur-3xl" />
        <div className="absolute -bottom-32 -right-20 w-96 h-96 bg-accent-rose/20 rounded-full blur-3xl" />

        <button
          onClick={() => navigate('/')}
          className="relative inline-flex items-center gap-2.5 group w-fit"
        >
          <span className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center shadow-glow transition-transform group-hover:scale-105">
            <ShoppingBag className="w-4.5 h-4.5 text-white" strokeWidth={2.4} />
          </span>
          <span className="font-display font-extrabold text-lg tracking-tight">
            Marketo<span className="text-brand-400">.</span>
          </span>
        </button>

        <div className="relative flex-1 flex flex-col justify-center max-w-md py-12">
          <span className="inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider w-fit">
            <Sparkles className="w-3 h-3 text-amber-300" />
            Espace vendeur
          </span>
          <h2 className="font-display text-4xl xl:text-5xl font-extrabold mt-5 leading-[1.1] text-balance">
            {mode === 'login' ? 'Heureux de vous revoir.' : 'Lancez votre boutique aujourd\'hui.'}
          </h2>
          <p className="mt-4 text-white/70 text-base leading-relaxed">
            {mode === 'login'
              ? 'Connectez-vous pour gérer vos produits, suivre vos commandes et faire grandir votre boutique.'
              : 'Rejoignez des centaines de vendeurs qui développent leur activité sur notre marketplace.'}
          </p>

          <ul className="mt-8 space-y-3.5">
            {BENEFITS.map(({ icon: Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-white/90">
                <span className="w-8 h-8 grid place-items-center rounded-xl bg-white/10 border border-white/15">
                  <Icon className="w-4 h-4" />
                </span>
                {label}
              </li>
            ))}
          </ul>

          {/* Testimonial card */}
          <div className="mt-10 bg-white/5 backdrop-blur-md border border-white/10 rounded-3xl p-5">
            <div className="flex items-center gap-0.5 text-amber-300">
              {[0,1,2,3,4].map((i) => <Star key={i} className="w-4 h-4 fill-current" />)}
            </div>
            <p className="mt-3 text-sm text-white/85 leading-relaxed italic">
              "En 3 mois, ma boutique a triplé ses ventes. La plateforme est ultra simple et mes clients adorent commander sur WhatsApp."
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="w-9 h-9 rounded-full bg-brand-gradient grid place-items-center text-sm font-bold">N</div>
              <div>
                <p className="text-sm font-semibold">Nadia B.</p>
                <p className="text-[11px] text-white/60">Boutique Atelier Aurora</p>
              </div>
            </div>
          </div>
        </div>

        <p className="relative text-xs text-white/40">© {new Date().getFullYear()} Marketo. Tous droits réservés.</p>
      </aside>

      {/* Form panel */}
      <main className="relative flex flex-col min-h-screen px-4 sm:px-8 py-8 sm:py-12">
        {/* Mobile brand */}
        <button
          onClick={() => navigate('/')}
          className="lg:hidden inline-flex items-center gap-2.5 group w-fit"
        >
          <span className="w-9 h-9 rounded-xl bg-brand-gradient grid place-items-center shadow-glowSm">
            <ShoppingBag className="w-4.5 h-4.5 text-white" strokeWidth={2.4} />
          </span>
          <span className="font-display font-extrabold text-lg text-ink">
            Marketo<span className="text-brand-600">.</span>
          </span>
        </button>

        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-md animate-fade-in">
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-ink leading-tight">
                  {mode === 'login' ? 'Connexion' : 'Créer un compte'}
                </h1>
                <p className="text-sm text-ink-muted mt-1.5">
                  {mode === 'login'
                    ? 'Accédez à votre espace vendeur'
                    : 'Commencez à vendre dès maintenant'}
                </p>
              </div>
            </div>

            {/* Mode switch */}
            <div className="bg-surface-tint p-1 rounded-full flex mb-6">
              {(['login', 'register'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => { setMode(m); setError(''); }}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-full transition-all ${
                    mode === m
                      ? 'bg-white text-ink shadow-soft'
                      : 'text-ink-muted hover:text-ink'
                  }`}
                >
                  {m === 'login' ? 'Connexion' : 'Inscription'}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="flex items-start gap-2 bg-rose-50 border border-rose-200 text-rose-600 text-sm px-4 py-3 rounded-2xl animate-pop">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              {/* Email */}
              <Field label="Adresse email" htmlFor="email" icon={Mail}>
                <input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="vous@exemple.com"
                  className="w-full pl-11 pr-4 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-brand-400 focus:ring-brand transition-all placeholder-ink-subtle"
                />
              </Field>

              {/* Password */}
              <Field
                label="Mot de passe"
                htmlFor="password"
                icon={Lock}
                hint={mode === 'register' ? 'Minimum 6 caractères' : undefined}
              >
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-11 pr-12 py-3.5 bg-white border border-slate-200 rounded-2xl text-sm focus:outline-none focus:border-brand-400 focus:ring-brand transition-all placeholder-ink-subtle"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-muted hover:text-ink p-1 rounded-lg transition-colors"
                  aria-label="Afficher le mot de passe"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </Field>

              {mode === 'login' && (
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-xs text-ink-muted cursor-pointer">
                    <input type="checkbox" className="w-4 h-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
                    Se souvenir de moi
                  </label>
                  <button type="button" className="text-xs font-semibold text-brand-700 hover:text-brand-800">
                    Mot de passe oublié ?
                  </button>
                </div>
              )}

              {mode === 'register' && (
                <PasswordStrength value={password} />
              )}

              <button
                type="submit"
                disabled={loading}
                className="group w-full flex items-center justify-center gap-2 bg-ink hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3.5 rounded-2xl text-sm transition-all duration-200 shadow-soft hover:shadow-elevated mt-2"
              >
                {loading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    {mode === 'login' ? 'Se connecter' : 'Créer mon compte'}
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200" />
                </div>
                <div className="relative flex justify-center">
                  <span className="bg-surface-alt px-3 text-[11px] font-semibold text-ink-muted uppercase tracking-wider">
                    Ou
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => navigate('/')}
                className="w-full flex items-center justify-center gap-2 bg-white text-ink-soft hover:text-ink border border-slate-200 hover:border-slate-300 font-semibold py-3.5 rounded-2xl text-sm transition-colors"
              >
                Continuer en visiteur
              </button>

              <p className="text-center text-sm text-ink-muted pt-2">
                {mode === 'login' ? (
                  <>
                    Pas encore de compte ?{' '}
                    <button
                      type="button"
                      onClick={() => { setMode('register'); setError(''); }}
                      className="text-brand-700 font-semibold hover:underline"
                    >
                      Créer un compte
                    </button>
                  </>
                ) : (
                  <>
                    Déjà inscrit ?{' '}
                    <button
                      type="button"
                      onClick={() => { setMode('login'); setError(''); }}
                      className="text-brand-700 font-semibold hover:underline"
                    >
                      Se connecter
                    </button>
                  </>
                )}
              </p>
            </form>
          </div>
        </div>

        <p className="text-center text-[11px] text-ink-muted mt-6">
          En continuant, vous acceptez nos <a href="#" className="underline">conditions</a> et notre <a href="#" className="underline">politique de confidentialité</a>.
        </p>
      </main>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  icon: Icon,
  hint,
  children,
}: {
  label: string;
  htmlFor: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label htmlFor={htmlFor} className="text-xs font-semibold text-ink-soft uppercase tracking-wider">
          {label}
        </label>
        {hint && <span className="text-[11px] text-ink-muted">{hint}</span>}
      </div>
      <div className="relative">
        <Icon className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-subtle pointer-events-none" />
        {children}
      </div>
    </div>
  );
}

function PasswordStrength({ value }: { value: string }) {
  const score = Math.min(
    4,
    (value.length >= 6 ? 1 : 0) +
      (/[A-Z]/.test(value) ? 1 : 0) +
      (/\d/.test(value) ? 1 : 0) +
      (/[^A-Za-z0-9]/.test(value) ? 1 : 0)
  );
  const labels = ['Trop faible', 'Faible', 'Moyen', 'Fort', 'Excellent'];
  const colors = ['bg-rose-400', 'bg-amber-400', 'bg-amber-500', 'bg-emerald-500', 'bg-emerald-600'];
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {[0,1,2,3].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i < score ? colors[score] : 'bg-slate-200'}`}
          />
        ))}
      </div>
      {value && (
        <p className="text-[11px] text-ink-muted flex items-center gap-1">
          {score >= 3 ? <CheckCircle className="w-3 h-3 text-emerald-500" /> : <AlertCircle className="w-3 h-3 text-amber-500" />}
          Sécurité : <span className="font-semibold text-ink-soft">{labels[score]}</span>
        </p>
      )}
    </div>
  );
}
