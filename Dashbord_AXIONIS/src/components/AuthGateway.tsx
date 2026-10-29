import React, { useState } from 'react';
import {
  Activity,
  Lock,
  Mail,
  User,
  Phone,
  Cpu,
  ArrowRight,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail,
} from 'firebase/auth';
import { auth, googleProvider, syncFirebaseUserProfile, setPendingAuthOptions } from '../firebase';
import { CareRole, UserAccount } from '../types';

interface AuthGatewayProps {
  defaultDeviceId: string;
  onAuthenticated: (user: UserAccount, allUsers: UserAccount[]) => void;
}

const GoogleIcon: React.FC<{ className?: string }> = ({ className = 'w-4 h-4' }) => (
  <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
    <path
      fill="#EA4335"
      d="M12 10.2v3.9h5.5c-.2 1.2-.9 2.3-2 3l3.2 2.5c1.9-1.7 3-4.3 3-7.4 0-.7-.1-1.4-.2-2H12z"
    />
    <path
      fill="#34A853"
      d="M12 22c2.7 0 5-.9 6.7-2.4l-3.2-2.5c-.9.6-2.1 1-3.5 1-2.7 0-5-1.8-5.8-4.3H2.9v2.6C4.6 19.8 8 22 12 22z"
    />
    <path
      fill="#4A90E2"
      d="M6.2 13.8c-.2-.6-.3-1.2-.3-1.8s.1-1.2.3-1.8V7.6H2.9C2.3 8.9 2 10.4 2 12s.3 3.1.9 4.4l3.3-2.6z"
    />
    <path
      fill="#FBBC05"
      d="M12 5.9c1.5 0 2.8.5 3.9 1.5l2.9-2.9C17 2.9 14.7 2 12 2 8 2 4.6 4.2 2.9 7.6l3.3 2.6c.8-2.5 3.1-4.3 5.8-4.3z"
    />
  </svg>
);

export const AuthGateway: React.FC<AuthGatewayProps> = ({
  defaultDeviceId,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPhone, setRegPhone] = useState('+62 812-');
  const [regDeviceId, setRegDeviceId] = useState(defaultDeviceId || 'AXIONIS-Edge-0417');
  const [regRole, setRegRole] = useState<CareRole>('Primary Caregiver');
  const [regPassword, setRegPassword] = useState('');

  const [resetEmail, setResetEmail] = useState('');
  const [resetNewPassword, setResetNewPassword] = useState('');

  // Login or Sign Up with Google via Firebase Auth Popup
  const handleGoogleAuth = async () => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    const syncOpts = {
      name: mode === 'register' && regName.trim() ? regName.trim() : undefined,
      deviceId: regDeviceId || defaultDeviceId,
      role: mode === 'register' ? regRole : undefined,
      phoneWa: mode === 'register' && regPhone.length > 8 ? regPhone : undefined,
    };
    setPendingAuthOptions(syncOpts);
    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const synced = await syncFirebaseUserProfile(cred.user, syncOpts);
      onAuthenticated(synced.user, synced.users);
    } catch (err: any) {
      setPendingAuthOptions(null);
      const code = err?.code || '';
      if (code === 'auth/popup-closed-by-user') {
        setErrorMsg('Jendela login Google ditutup sebelum selesai.');
      } else if (code === 'auth/unauthorized-domain') {
        const currentDomain = window.location.hostname;
        setErrorMsg(
          `Domain "${currentDomain}" belum diizinkan di Firebase. Buka Firebase Console (Project: causal-sum-3xhgq) → Authentication → Settings → Authorized domains → Klik "Add domain" dan tambahkan: ${currentDomain} (atau gunakan Login/Sign Up dengan Email di bawah).`
        );
      } else {
        setErrorMsg(err?.message || 'Gagal autentikasi dengan Google Firebase.');
      }
      setIsSubmitting(false);
    }
  };

  // Login with Email & Password (Firebase Auth + Backend Sync)
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      const cred = await signInWithEmailAndPassword(auth, loginEmail.trim(), loginPassword);
      const synced = await syncFirebaseUserProfile(cred.user, {
        deviceId: defaultDeviceId,
      });
      onAuthenticated(synced.user, synced.users);
    } catch (fbErr: any) {
      // Fallback to backend auth if Email/Password provider is not enabled in Firebase Console
      try {
        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: loginEmail, password: loginPassword }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'Email atau kata sandi tidak sesuai.');
          setIsSubmitting(false);
          return;
        }
        onAuthenticated(data.user, data.users || []);
      } catch {
        setErrorMsg(fbErr?.message || 'Gagal menghubungi layanan autentikasi.');
        setIsSubmitting(false);
      }
    }
  };

  // Sign Up with Email & Password (Firebase Auth + Backend Sync)
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    const syncOpts = {
      name: regName.trim(),
      phoneWa: regPhone.trim(),
      deviceId: regDeviceId.trim() || defaultDeviceId,
      role: regRole,
    };
    setPendingAuthOptions(syncOpts);
    try {
      const cred = await createUserWithEmailAndPassword(auth, regEmail.trim(), regPassword);
      if (regName.trim()) {
        await updateProfile(cred.user, { displayName: regName.trim() });
      }
      const synced = await syncFirebaseUserProfile(cred.user, syncOpts);
      onAuthenticated(synced.user, synced.users);
    } catch (fbErr: any) {
      setPendingAuthOptions(null);
      // Fallback to backend registration if Email/Password provider is disabled in Firebase Console
      try {
        const res = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: regName,
            email: regEmail,
            phoneWa: regPhone,
            deviceId: regDeviceId,
            role: regRole,
            password: regPassword,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setErrorMsg(data.error || 'Gagal mendaftarkan akun.');
          setIsSubmitting(false);
          return;
        }
        onAuthenticated(data.user, data.users || []);
      } catch {
        setErrorMsg(fbErr?.message || 'Gagal mendaftarkan akun baru.');
        setIsSubmitting(false);
      }
    }
  };

  // Reset Password
  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setSuccessMsg(null);
    setIsSubmitting(true);
    try {
      if (!resetNewPassword.trim()) {
        await sendPasswordResetEmail(auth, resetEmail.trim());
        setSuccessMsg(`Tautan reset kata sandi Firebase telah dikirim ke ${resetEmail}.`);
        setIsSubmitting(false);
        return;
      }
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resetEmail, newPassword: resetNewPassword }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMsg(data.error || 'Email tidak ditemukan.');
        setIsSubmitting(false);
        return;
      }
      setSuccessMsg(data.message || 'Kata sandi berhasil diperbarui. Silakan masuk.');
      setLoginEmail(resetEmail);
      setLoginPassword(resetNewPassword);
      setIsSubmitting(false);
      setTimeout(() => setMode('login'), 1200);
    } catch {
      setErrorMsg('Gagal mereset kata sandi.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full max-w-full overflow-x-hidden bg-zinc-950 text-zinc-100 flex flex-col justify-center items-center p-3 sm:p-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800/90 bg-zinc-900 overflow-hidden shadow-xl p-5 sm:p-7 space-y-5">
        {/* Header Brand */}
        <div className="space-y-2 text-center">
          <div className="w-10 h-10 rounded-xl bg-teal-950/80 border border-teal-800/50 flex items-center justify-center mx-auto">
            <Activity className="w-5 h-5 text-teal-400" />
          </div>
          <h1 className="text-base sm:text-lg font-bold tracking-tight text-zinc-100 font-display">
            AXIONIS Care Watch
          </h1>
          <p className="text-xs text-zinc-400">
            Autentikasi Firebase · Edge-AIoT Stroke Screening
          </p>
        </div>

        {/* Segmented Mode Switcher */}
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-zinc-950 border border-zinc-800">
          {[
            { id: 'login' as const, label: 'Login' },
            { id: 'register' as const, label: 'Sign Up' },
            { id: 'reset' as const, label: 'Reset Sandi' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setMode(tab.id);
                setErrorMsg(null);
                setSuccessMsg(null);
              }}
              className={`min-h-[38px] px-1.5 rounded-lg text-xs font-medium transition-colors truncate ${
                mode === tab.id
                  ? 'bg-teal-700 text-white font-semibold'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {errorMsg && (
          <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-800/50 text-rose-300 text-xs flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span className="break-words">{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="p-3 rounded-xl bg-teal-950/50 border border-teal-800/50 text-teal-300 text-xs flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span className="break-words">{successMsg}</span>
          </div>
        )}

        {/* Google Login / Sign Up Button (Shown in Login & Register Modes) */}
        {(mode === 'login' || mode === 'register') && (
          <div className="space-y-3">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={handleGoogleAuth}
              className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-zinc-100 hover:bg-white text-zinc-900 font-semibold text-xs transition-colors flex items-center justify-center gap-2.5 shadow-sm"
            >
              <GoogleIcon className="w-4 h-4 shrink-0" />
              <span>
                {mode === 'login'
                  ? 'Login dengan Akun Google'
                  : 'Sign Up dengan Akun Google'}
              </span>
            </button>

            <div className="relative flex items-center py-1">
              <div className="flex-grow border-t border-zinc-800" />
              <span className="shrink-0 px-3 text-[11px] text-zinc-500">atau gunakan email</span>
              <div className="flex-grow border-t border-zinc-800" />
            </div>
          </div>
        )}

        {/* 1. LOGIN FORM */}
        {mode === 'login' && (
          <form onSubmit={handleLogin} className="space-y-3.5 text-xs">
            <div className="space-y-3">
              <div>
                <label className="block text-zinc-400 mb-1">Alamat Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Kata Sandi</label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="password"
                    required
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    placeholder="Masukkan kata sandi"
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 focus:border-teal-600 focus:outline-none"
                  />
                </div>
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[44px] rounded-xl bg-teal-700 hover:bg-teal-600 text-white font-semibold text-xs transition-colors flex items-center justify-center gap-2"
            >
              <span>{isSubmitting ? 'Memverifikasi...' : 'Login dengan Email'}</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        )}

        {/* 2. SIGN UP / REGISTER FORM */}
        {mode === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-zinc-400 mb-1">Nama Lengkap</label>
                <div className="relative">
                  <User className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    required
                    value={regName}
                    onChange={(e) => setRegName(e.target.value)}
                    placeholder="Nama Anda"
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Email</label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="email"
                    required
                    value={regEmail}
                    onChange={(e) => setRegEmail(e.target.value)}
                    placeholder="nama@email.com"
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-zinc-400 mb-1">No. WhatsApp</label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={regPhone}
                    onChange={(e) => setRegPhone(e.target.value)}
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">ID Perangkat</label>
                <div className="relative">
                  <Cpu className="w-4 h-4 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={regDeviceId}
                    onChange={(e) => setRegDeviceId(e.target.value)}
                    className="w-full min-h-[42px] pl-9 pr-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100 font-mono"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div>
                <label className="block text-zinc-400 mb-1">Peran Akses</label>
                <select
                  value={regRole}
                  onChange={(e) => setRegRole(e.target.value as CareRole)}
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                >
                  <option value="Primary Caregiver">Primary Caregiver</option>
                  <option value="Family Viewer">Family Viewer</option>
                </select>
              </div>

              <div>
                <label className="block text-zinc-400 mb-1">Kata Sandi</label>
                <input
                  type="password"
                  required
                  value={regPassword}
                  onChange={(e) => setRegPassword(e.target.value)}
                  placeholder="Min. 6 karakter"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[44px] rounded-xl bg-teal-700 hover:bg-teal-600 text-white font-semibold text-xs transition-colors"
            >
              {isSubmitting ? 'Mendaftarkan...' : 'Sign Up dengan Email'}
            </button>
          </form>
        )}

        {/* 3. RESET PASSWORD FORM */}
        {mode === 'reset' && (
          <form onSubmit={handleReset} className="space-y-3.5 text-xs">
            <div className="space-y-3">
              <div>
                <label className="block text-zinc-400 mb-1">Email Terdaftar</label>
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="nama@email.com"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                />
              </div>
              <div>
                <label className="block text-zinc-400 mb-1">Kata Sandi Baru</label>
                <input
                  type="password"
                  value={resetNewPassword}
                  onChange={(e) => setResetNewPassword(e.target.value)}
                  placeholder="Kosongkan untuk kirim email link Firebase"
                  className="w-full min-h-[42px] px-3 py-2 rounded-xl bg-zinc-950 border border-zinc-800 text-zinc-100"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full min-h-[44px] rounded-xl bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700 font-semibold text-xs transition-colors"
            >
              Reset Kata Sandi
            </button>
          </form>
        )}
      </div>
    </div>
  );
};
