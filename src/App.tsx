import React, { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  Check,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FolderOpen,
  KeyRound,
  LogOut,
  Monitor,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  where,
} from 'firebase/firestore';
import { User } from 'firebase/auth';
import {
  ActivePicProfile,
  AppTaxonomy,
  BOOTSTRAPPED_ADMIN_EMAIL,
  DEFAULT_LOCATIONS,
  DEFAULT_WORK_STAGES,
  DRIVE_ROOT_FOLDER_URL,
  ManagedUser,
  PhotoSubmission,
} from './types';
import {
  connectGoogleDriveDirect,
  db,
  FIREBASE_PROJECT_ID,
  googleSignIn,
  handleFirestoreError,
  initAuth,
  loginWithUsernamePassword,
  logout,
  OperationType,
} from './lib/firebase';
import { GoogleSignInButton } from './components/GoogleSignInButton';
import { FieldCaptureView } from './components/FieldCaptureView';
import { AdminDashboard } from './components/AdminDashboard';
import { ViewerDashboard } from './components/ViewerDashboard';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

class AppErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, message: '' };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, message: error.message };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Uncaught app error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4">
            <h2 className="text-base font-bold text-slate-900">
              Terjadi Gangguan Aplikasi
            </h2>
            <p className="text-xs text-slate-600 break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="min-h-[40px] w-full rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800"
            >
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function sortSubmissionsDesc(items: PhotoSubmission[]): PhotoSubmission[] {
  return [...items].sort((a, b) => {
    const dtA = `${a.capturedDate || ''} ${a.capturedTime || ''}`;
    const dtB = `${b.capturedDate || ''} ${b.capturedTime || ''}`;
    return dtB.localeCompare(dtA);
  });
}

function MainApp() {
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [authError, setAuthError] = useState('');
  const [copiedHost, setCopiedHost] = useState(false);

  // Username & Password login form state
  const [usernameInput, setUsernameInput] = useState('');
  const [passwordInput, setPasswordInput] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [workStages, setWorkStages] = useState<string[]>(DEFAULT_WORK_STAGES);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [isRegisteredAdmin, setIsRegisteredAdmin] = useState(false);
  const [adminCheckDone, setAdminCheckDone] = useState(false);
  const [submissions, setSubmissions] = useState<PhotoSubmission[]>([]);

  // Optional PIC Session override for Admin testing
  const [picOverride, setPicOverride] = useState<ActivePicProfile | null>(null);
  const [picModalOpen, setPicModalOpen] = useState(false);
  const [switchUsername, setSwitchUsername] = useState('');
  const [switchPassword, setSwitchPassword] = useState('');
  const [picSwitchError, setPicSwitchError] = useState('');

  useEffect(() => {
    const unsub = initAuth((user, token) => {
      setFirebaseUser(user);
      setAccessToken(token);
      setAuthReady(true);
      if (!user) {
        setPicOverride(null);
        setManagedUsers([]);
        setSubmissions([]);
        setUsersLoaded(false);
        setIsRegisteredAdmin(false);
        setAdminCheckDone(false);
      }
    });
    return () => unsub();
  }, []);

  const userEmail = (firebaseUser?.email || '').toLowerCase();
  const isPasswordProvider = Boolean(
    firebaseUser?.providerData?.some((p) => p.providerId === 'password')
  );
  const isGoogleVerified = Boolean(
    firebaseUser && !isPasswordProvider && firebaseUser.emailVerified
  );
  const isBootstrappedAdmin =
    isGoogleVerified && userEmail === BOOTSTRAPPED_ADMIN_EMAIL;
  const isAuthenticated = Boolean(firebaseUser && (isPasswordProvider || isGoogleVerified));

  // Check admin_emails registry
  useEffect(() => {
    if (!isAuthenticated || !userEmail) return;
    if (isBootstrappedAdmin) {
      setIsRegisteredAdmin(true);
      setAdminCheckDone(true);
      return;
    }

    getDoc(doc(db, 'admin_emails', userEmail))
      .then((snap) => {
        setIsRegisteredAdmin(snap.exists() && snap.data()?.active === true);
      })
      .catch(() => {
        setIsRegisteredAdmin(false);
      })
      .finally(() => {
        setAdminCheckDone(true);
      });
  }, [isAuthenticated, userEmail, isBootstrappedAdmin]);

  // Load taxonomy config
  useEffect(() => {
    if (!isAuthenticated) return;
    getDoc(doc(db, 'config', 'app_taxonomy'))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as AppTaxonomy;
          if (Array.isArray(data.locations) && data.locations.length > 0) {
            setLocations(data.locations);
          }
          if (Array.isArray(data.workStages) && data.workStages.length > 0) {
            setWorkStages(data.workStages);
          }
        }
      })
      .catch((err) => {
        console.warn('Taxonomy load fallback to defaults:', err);
      });
  }, [isAuthenticated]);

  // Listen to managed_users
  useEffect(() => {
    if (!isAuthenticated || !adminCheckDone) return;

    let q;
    if (isBootstrappedAdmin) {
      q = collection(db, 'managed_users');
    } else if (isRegisteredAdmin) {
      q = query(
        collection(db, 'managed_users'),
        where('adminEmails', 'array-contains', userEmail)
      );
    } else if (isPasswordProvider) {
      q = query(
        collection(db, 'managed_users'),
        where('authEmail', '==', userEmail)
      );
    } else {
      q = query(
        collection(db, 'managed_users'),
        where('googleEmail', '==', userEmail)
      );
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as ManagedUser);
        setManagedUsers(list);
        setUsersLoaded(true);
      },
      (err) => {
        setUsersLoaded(true);
        handleFirestoreError(err, OperationType.LIST, 'managed_users');
      }
    );

    return () => unsub();
  }, [
    isAuthenticated,
    adminCheckDone,
    isBootstrappedAdmin,
    isRegisteredAdmin,
    isPasswordProvider,
    userEmail,
  ]);

  // Resolve active PIC profile
  const activeProfile = useMemo<ActivePicProfile | null>(() => {
    if (!firebaseUser || !isAuthenticated) return null;
    if (picOverride) return picOverride;

    const matched = managedUsers.find((u) => {
      if (!u.active) return false;
      if (isPasswordProvider && u.authEmail?.toLowerCase() === userEmail) {
        return true;
      }
      if (!isPasswordProvider && u.googleEmail?.toLowerCase() === userEmail) {
        return true;
      }
      return false;
    });

    if (matched) {
      return {
        source: 'managed_user',
        id: matched.id,
        picName: matched.picName,
        username: matched.username,
        role: matched.role,
        location: matched.location,
        devicePolicy: matched.devicePolicy,
      };
    }

    if (isBootstrappedAdmin) {
      return {
        source: 'bootstrapped_admin',
        id: 'bootstrapped_admin',
        picName: firebaseUser.displayName || 'Admin Pusat',
        username: 'Pusat',
        role: 'admin',
        location: 'Pusat',
        devicePolicy: 'windows_pc',
      };
    }

    return null;
  }, [
    firebaseUser,
    isAuthenticated,
    picOverride,
    managedUsers,
    isPasswordProvider,
    userEmail,
    isBootstrappedAdmin,
  ]);

  // Listen to photo_submissions scoped by role
  useEffect(() => {
    if (!firebaseUser || !isAuthenticated || !activeProfile) return;

    let q;
    if (isBootstrappedAdmin) {
      q = collection(db, 'photo_submissions');
    } else if (activeProfile.role === 'viewer') {
      q = query(
        collection(db, 'photo_submissions'),
        where('viewerEmails', 'array-contains', userEmail)
      );
    } else if (activeProfile.role === 'admin') {
      q = query(
        collection(db, 'photo_submissions'),
        where('adminEmails', 'array-contains', userEmail)
      );
    } else {
      q = query(
        collection(db, 'photo_submissions'),
        where('uploadedByUid', '==', firebaseUser.uid)
      );
    }

    const unsub = onSnapshot(
      q,
      (snap) => {
        const list = snap.docs.map((d) => d.data() as PhotoSubmission);
        setSubmissions(sortSubmissionsDesc(list));
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, 'photo_submissions');
      }
    );

    return () => unsub();
  }, [firebaseUser, isAuthenticated, activeProfile, isBootstrappedAdmin, userEmail]);

  const handleUsernamePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const uname = usernameInput.trim();
    const pwd = passwordInput.trim();
    if (!uname || !pwd) {
      setAuthError('Masukkan username dan password.');
      return;
    }

    setIsLoggingIn(true);
    try {
      const user = await loginWithUsernamePassword(uname, pwd);
      setFirebaseUser(user);
    } catch (err: unknown) {
      const code =
        typeof err === 'object' && err !== null && 'code' in err
          ? String((err as { code: unknown }).code)
          : '';
      const msg = err instanceof Error ? err.message : String(err);

      if (code === 'auth/operation-not-allowed' || msg.includes('operation-not-allowed')) {
        setAuthError(
          'auth/operation-not-allowed: Login Email/Password belum diaktifkan di Firebase Console.'
        );
      } else if (
        code === 'auth/invalid-credential' ||
        code === 'auth/user-not-found' ||
        code === 'auth/wrong-password'
      ) {
        setAuthError(
          'Username atau password tidak cocok, atau akun belum disinkronkan oleh Admin di Manajemen User.'
        );
      } else {
        setAuthError(msg);
      }
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleGoogleLogin = async (): Promise<string | null> => {
    setIsLoggingIn(true);
    setAuthError('');
    try {
      const res = await googleSignIn();
      if (res) {
        setFirebaseUser(res.user);
        setAccessToken(res.accessToken);
        return res.accessToken;
      }
      return null;
    } catch (err) {
      setAuthError(
        err instanceof Error
          ? err.message
          : 'Login Google gagal. Pastikan pop-up browser diizinkan.'
      );
      return null;
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleConnectDriveToken = async (): Promise<string | null> => {
    try {
      const token = await connectGoogleDriveDirect();
      setAccessToken(token);
      return token;
    } catch (err) {
      console.error('Drive token error:', err);
      return null;
    }
  };

  const handleLogout = async () => {
    setPicOverride(null);
    setUsernameInput('');
    setPasswordInput('');
    await logout();
  };

  const handlePicCredentialSwitch = (e: React.FormEvent) => {
    e.preventDefault();
    setPicSwitchError('');
    const uname = switchUsername.trim().toLowerCase();
    const pwd = switchPassword.trim();

    const matched = managedUsers.find(
      (u) =>
        u.active &&
        u.username.trim().toLowerCase() === uname &&
        u.password === pwd
    );

    if (!matched) {
      setPicSwitchError(
        'Username atau password tidak ditemukan pada tabel User Management (atau akun nonaktif).'
      );
      return;
    }

    setPicOverride({
      source: 'managed_user',
      id: matched.id,
      picName: matched.picName,
      username: matched.username,
      role: matched.role,
      location: matched.location,
      devicePolicy: matched.devicePolicy,
    });
    setPicModalOpen(false);
    setSwitchUsername('');
    setSwitchPassword('');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm font-medium text-slate-600">Memuat aplikasi...</p>
      </div>
    );
  }

  // Unauthenticated Login Screen (Username & Password Primary + Google Secondary)
  if (!firebaseUser) {
    const isUnauthorizedDomain =
      authError.includes('unauthorized-domain') || authError.includes('origin');
    const isProviderDisabled = authError.includes('operation-not-allowed');

    return (
      <div className="min-h-screen bg-slate-50 flex flex-col">
        <header className="border-b border-slate-200 bg-white px-6 py-4">
          <div className="mx-auto flex max-w-6xl items-center justify-between gap-8">
            <span className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
              FieldSnap Drive
            </span>
            <a
              href={DRIVE_ROOT_FOLDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 whitespace-nowrap shrink-0"
            >
              <FolderOpen className="h-4 w-4 text-blue-700" />
              Folder Google Drive
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </header>

        <main className="mx-auto flex flex-1 w-full max-w-6xl items-center px-4 py-8 sm:px-6 sm:py-12">
          <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 items-stretch">
            {/* Left: Login Form with Username & Password */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 flex flex-col justify-center space-y-6 lg:col-span-6">
              <div className="space-y-1.5">
                <p className="text-xs font-semibold tracking-wide text-blue-700">
                  Dokumentasi Peralatan &amp; Dokumen Lapangan
                </p>
                <h1 className="font-display text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                  Masuk ke FieldSnap Drive
                </h1>
                <p className="text-xs sm:text-sm text-slate-600">
                  Gunakan Username dan Password sesuai data otorisasi (User, Viewer, atau Admin).
                </p>
              </div>

              <form onSubmit={handleUsernamePasswordSubmit} className="space-y-4">
                <div>
                  <label
                    htmlFor="login-username"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Username
                  </label>
                  <input
                    id="login-username"
                    type="text"
                    autoComplete="username"
                    value={usernameInput}
                    onChange={(e) => setUsernameInput(e.target.value)}
                    placeholder="Masukkan username (contoh: Wahyu, Neneng, Pusat)"
                    required
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3.5 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                  />
                </div>

                <div>
                  <label
                    htmlFor="login-password"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Password
                  </label>
                  <div className="relative">
                    <input
                      id="login-password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      value={passwordInput}
                      onChange={(e) => setPasswordInput(e.target.value)}
                      placeholder="Masukkan password"
                      required
                      className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white pl-3.5 pr-11 text-sm text-slate-900 focus:border-blue-700 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-slate-400 hover:text-slate-700"
                      aria-label={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isLoggingIn}
                  className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:opacity-60"
                >
                  <KeyRound className="h-4 w-4" />
                  {isLoggingIn ? 'Memverifikasi...' : 'Masuk dengan Username'}
                </button>
              </form>

              {authError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-900 space-y-2.5">
                  <p className="font-semibold text-red-800">{authError}</p>

                  {isProviderDisabled && (
                    <div className="space-y-1.5 border-t border-red-200 pt-2 text-slate-700">
                      <p>
                        Aktifkan provider <strong>Email/Password</strong> di Firebase Console:
                        Authentication → Sign-in method → Add new provider → Email/Password.
                      </p>
                      <a
                        href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                      >
                        Buka Firebase Sign-in Method
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  )}

                  {isUnauthorizedDomain && (
                    <div className="space-y-2 border-t border-red-200 pt-2.5 text-slate-700">
                      <p>
                        Untuk login via popup Google di domain ini, tambahkan domain ke{' '}
                        <strong>Firebase Authorized Domains</strong>:
                      </p>
                      <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-white px-3 py-2">
                        <span className="font-mono text-[11px] text-slate-900 break-all">
                          {typeof window !== 'undefined' ? window.location.hostname : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(window.location.hostname);
                            setCopiedHost(true);
                            setTimeout(() => setCopiedHost(false), 2000);
                          }}
                          className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-slate-800 shrink-0"
                        >
                          {copiedHost ? (
                            <>
                              <Check className="h-3 w-3" />
                              Tersalin
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" />
                              Salin Domain
                            </>
                          )}
                        </button>
                      </div>
                      <div className="flex flex-wrap gap-3 pt-1">
                        <a
                          href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/settings`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline"
                        >
                          Buka Firebase Authorized Domains
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="relative flex items-center py-1">
                <div className="flex-grow border-t border-slate-200" />
                <span className="mx-3 shrink text-xs text-slate-400">
                  atau akun Admin Google
                </span>
                <div className="flex-grow border-t border-slate-200" />
              </div>

              <GoogleSignInButton
                onClick={handleGoogleLogin}
                disabled={isLoggingIn}
                label="Masuk sebagai Admin (Google)"
                className="w-full"
              />
            </div>

            {/* Right: Role & Device Policy Info */}
            <div className="rounded-2xl border border-slate-200 bg-white p-6 sm:p-8 space-y-6 lg:col-span-6 flex flex-col justify-between">
              <div className="space-y-2">
                <h2 className="text-base font-semibold text-slate-900">
                  Ketentuan Peran, Perangkat &amp; Google Drive
                </h2>
                <p className="text-xs leading-relaxed text-slate-600">
                  Semua foto peralatan lapangan dan foto dokumen disimpan terpusat ke Google Drive dengan penamaan folder otomatis berdasarkan lokasi, tahapan pekerjaan, dan tanggal kegiatan.
                </p>
              </div>

              <div className="space-y-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
                    <Smartphone className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      User Lapangan (HP Cellular Android)
                    </p>
                    <p className="text-xs text-slate-600">
                      Mengambil foto peralatan dan dokumen di lapangan lengkap dengan jam, tanggal, dan koordinat GPS perangkat seluler.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50 text-blue-700">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Admin (PC Windows)
                    </p>
                    <p className="text-xs text-slate-600">
                      Mengelola tabel manajemen user (user, admin, viewer) dan memvalidasi kelayakan foto lapangan.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-700">
                    <Monitor className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-900">
                      Viewer (PC Windows)
                    </p>
                    <p className="text-xs text-slate-600">
                      Melihat dokumentasi foto yang dikirim user, terbatas hanya pada lokasi wilayah tugas masing-masing.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 text-xs text-slate-500 space-y-1">
                <div>
                  Format Folder:{' '}
                  <span className="font-mono text-slate-800">
                    [Lokasi] - [Tahapan] - [Tanggal]
                  </span>
                </div>
                <div>
                  Format File:{' '}
                  <span className="font-mono text-slate-800">
                    [Lokasi]_[Tahapan]_[Kategori]_[Waktu].jpg
                  </span>
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Signed-in user not mapped in managed_users
  if (usersLoaded && adminCheckDone && !activeProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-center">
          <h2 className="text-base font-bold text-slate-900">
            Akun Belum Terdaftar di Tabel User Management
          </h2>
          <p className="text-xs leading-relaxed text-slate-600">
            Akun <strong className="text-slate-900">{firebaseUser.email}</strong> tidak ditemukan atau statusnya nonaktif pada tabel Manajemen User.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Keluar &amp; Login Ulang
          </button>
        </div>
      </div>
    );
  }

  if (!activeProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm font-medium text-slate-600">Menyiapkan sesi pengguna...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 3-Zone Top Navigation Bar */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-6 px-4 py-3 sm:px-6">
          {/* Zone 1: Brand Wordmark */}
          <span className="font-display text-base sm:text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            FieldSnap Drive
          </span>

          {/* Zone 2: Clean Typographic Context Info */}
          <div className="hidden md:flex items-center gap-3 text-xs text-slate-600 truncate">
            <span className="font-semibold text-slate-900 truncate">
              {activeProfile.picName}
            </span>
            <span aria-hidden="true">·</span>
            <span className="capitalize font-medium text-blue-700 whitespace-nowrap">
              {activeProfile.role}
            </span>
            <span aria-hidden="true">·</span>
            <span className="whitespace-nowrap">{activeProfile.location}</span>
            <span aria-hidden="true">·</span>
            {accessToken ? (
              <span className="font-medium text-emerald-700 whitespace-nowrap">
                Google Drive Terhubung
              </span>
            ) : (
              <button
                type="button"
                onClick={handleConnectDriveToken}
                className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline whitespace-nowrap"
              >
                <RefreshCw className="h-3 w-3" />
                Hubungkan Google Drive
              </button>
            )}
          </div>

          {/* Zone 3: Session Action */}
          <div className="flex items-center gap-2 shrink-0">
            {!accessToken && (
              <button
                type="button"
                onClick={handleConnectDriveToken}
                className="md:hidden inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Drive
              </button>
            )}

            {(isBootstrappedAdmin || isRegisteredAdmin) &&
              !picOverride &&
              managedUsers.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setPicSwitchError('');
                    setPicModalOpen(true);
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                >
                  <KeyRound className="h-3.5 w-3.5" />
                  Uji Akun PIC
                </button>
              )}

            {picOverride && (
              <button
                type="button"
                onClick={() => setPicOverride(null)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
              >
                Kembali ke Admin
              </button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <LogOut className="h-3.5 w-3.5" />
              Keluar
            </button>
          </div>
        </div>
      </header>

      {/* Role-Based Workspace */}
      <div className="flex-1">
        {activeProfile.role === 'user' && (
          <FieldCaptureView
            picProfile={activeProfile}
            userUid={firebaseUser.uid}
            userEmail={userEmail}
            accessToken={accessToken}
            locations={locations}
            workStages={workStages}
            submissions={submissions}
            managedUsers={managedUsers}
            onRequestReconnectDrive={handleConnectDriveToken}
          />
        )}

        {activeProfile.role === 'viewer' && (
          <ViewerDashboard
            picProfile={activeProfile}
            accessToken={accessToken}
            submissions={submissions}
            workStages={workStages}
            onRequestReconnectDrive={handleConnectDriveToken}
          />
        )}

        {activeProfile.role === 'admin' && (
          <AdminDashboard
            picProfile={activeProfile}
            userUid={firebaseUser.uid}
            userEmail={userEmail}
            accessToken={accessToken}
            submissions={submissions}
            managedUsers={managedUsers}
            locations={locations}
            workStages={workStages}
            onRequestReconnectDrive={handleConnectDriveToken}
          />
        )}
      </div>

      {/* PIC Login Modal */}
      {picModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Camera className="h-4 w-4 text-blue-700" />
                <h3 className="text-base font-semibold text-slate-900">
                  Masuk Sesi PIC (User / Viewer / Admin)
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setPicModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1 text-xs text-slate-500">
              Masukkan username dan password dari tabel Manajemen User untuk membuka tampilan sesuai otorisasi dan lokasi akun tersebut.
            </p>

            <form onSubmit={handlePicCredentialSwitch} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={switchUsername}
                  onChange={(e) => setSwitchUsername(e.target.value)}
                  required
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Password
                </label>
                <input
                  type="password"
                  value={switchPassword}
                  onChange={(e) => setSwitchPassword(e.target.value)}
                  required
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                />
              </div>

              {picSwitchError && (
                <p className="text-xs font-medium text-red-700">{picSwitchError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setPicModalOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800"
                >
                  Masuk Sesi PIC
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppErrorBoundary>
      <MainApp />
    </AppErrorBoundary>
  );
}
