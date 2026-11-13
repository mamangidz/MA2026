import React, { Component, ErrorInfo, ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Camera,
  ExternalLink,
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
  db,
  googleSignIn,
  handleFirestoreError,
  initAuth,
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

  const [locations, setLocations] = useState<string[]>(DEFAULT_LOCATIONS);
  const [workStages, setWorkStages] = useState<string[]>(DEFAULT_WORK_STAGES);
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoaded, setUsersLoaded] = useState(false);
  const [submissions, setSubmissions] = useState<PhotoSubmission[]>([]);

  // Optional PIC Session override (e.g. Admin testing User/Viewer credentials from User Management table)
  const [picOverride, setPicOverride] = useState<ActivePicProfile | null>(null);
  const [picModalOpen, setPicModalOpen] = useState(false);
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [picLoginError, setPicLoginError] = useState('');

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
      }
    });
    return () => unsub();
  }, []);

  const userEmail = (firebaseUser?.email || '').toLowerCase();
  const isBootstrappedAdmin =
    Boolean(firebaseUser?.emailVerified) &&
    userEmail === BOOTSTRAPPED_ADMIN_EMAIL;

  // Load taxonomy config
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) return;
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
  }, [firebaseUser]);

  // Listen to managed_users
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified) return;

    const q = isBootstrappedAdmin
      ? collection(db, 'managed_users')
      : query(
          collection(db, 'managed_users'),
          where('googleEmail', '==', userEmail)
        );

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
  }, [firebaseUser, isBootstrappedAdmin, userEmail]);

  // Resolve active PIC profile
  const activeProfile = useMemo<ActivePicProfile | null>(() => {
    if (!firebaseUser) return null;
    if (picOverride) return picOverride;

    const matched = managedUsers.find(
      (u) =>
        u.active &&
        u.googleEmail &&
        u.googleEmail.toLowerCase() === userEmail
    );

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
  }, [firebaseUser, picOverride, managedUsers, userEmail, isBootstrappedAdmin]);

  // Listen to photo_submissions scoped by role
  useEffect(() => {
    if (!firebaseUser || !firebaseUser.emailVerified || !activeProfile) return;

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
  }, [firebaseUser, activeProfile, isBootstrappedAdmin, userEmail]);

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

  const handleLogout = async () => {
    setPicOverride(null);
    await logout();
  };

  const handlePicCredentialLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setPicLoginError('');
    const uname = loginUsername.trim().toLowerCase();
    const pwd = loginPassword.trim();

    const matched = managedUsers.find(
      (u) =>
        u.active &&
        u.username.trim().toLowerCase() === uname &&
        u.password === pwd
    );

    if (!matched) {
      setPicLoginError(
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
    setLoginUsername('');
    setLoginPassword('');
  };

  if (!authReady) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <p className="text-sm font-medium text-slate-600">Memuat aplikasi...</p>
      </div>
    );
  }

  // Unauthenticated Landing / Sign-In Screen
  if (!firebaseUser) {
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

        <main className="mx-auto flex flex-1 w-full max-w-6xl items-center px-4 py-12 sm:px-6">
          <div className="grid w-full grid-cols-1 gap-8 lg:grid-cols-12 items-stretch">
            <div className="flex flex-col justify-center space-y-6 lg:col-span-7">
              <div className="space-y-3">
                <p className="text-xs font-semibold tracking-wide text-blue-700">
                  Dokumentasi Peralatan &amp; Dokumen Lapangan
                </p>
                <h1 className="font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl text-balance">
                  Pengumpulan Foto Lapangan Terstruktur ke Google Drive
                </h1>
                <p className="max-w-xl text-base leading-relaxed text-slate-600">
                  Kirim foto peralatan dan dokumen langsung dari telepon seluler Android dengan penandaan waktu, tanggal, dan GPS otomatis ke folder Google Drive sesuai lokasi dan tahapan pekerjaan.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4">
                <GoogleSignInButton
                  onClick={handleGoogleLogin}
                  disabled={isLoggingIn}
                  label={isLoggingIn ? 'Menghubungkan...' : 'Masuk dengan Google Drive'}
                />
              </div>

              {authError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-800 max-w-md">
                  {authError}
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-slate-200 bg-white p-6 space-y-5 lg:col-span-5 flex flex-col justify-between">
              <h2 className="text-sm font-semibold text-slate-900">
                Ketentuan Peran &amp; Perangkat
              </h2>

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
                      Input foto peralatan &amp; dokumen di lapangan lengkap dengan koordinat GPS, jam, dan tanggal perangkat.
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
                      Mengelola tabel user management (user, admin, viewer) dan memvalidasi kelayakan foto lapangan.
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
                      Melihat foto peralatan dan dokumen secara terbatas hanya untuk lokasi penugasan masing-masing.
                    </p>
                  </div>
                </div>
              </div>

              <div className="border-t border-slate-100 pt-4 text-xs text-slate-500">
                Folder Penyimpanan:{' '}
                <span className="font-mono text-slate-800">
                  [Lokasi] - [Tahapan] - [Tanggal]
                </span>
              </div>
            </div>
          </div>
        </main>
      </div>
    );
  }

  // Signed-in user not yet mapped in managed_users (and not bootstrapped admin)
  if (usersLoaded && !activeProfile) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 space-y-4 text-center">
          <h2 className="text-base font-bold text-slate-900">
            Akun Google Belum Terdaftar di User Management
          </h2>
          <p className="text-xs leading-relaxed text-slate-600">
            Email <strong className="text-slate-900">{firebaseUser.email}</strong> belum dihubungkan oleh Admin ke peran User, Viewer, atau Admin pada tabel User Management.
          </p>
          <p className="text-xs text-slate-500">
            Hubungi Admin untuk menambahkan email Google Anda pada kolom Email Google di tabel Manajemen User.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-white px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Keluar &amp; Ganti Akun Google
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
                onClick={handleGoogleLogin}
                className="inline-flex items-center gap-1 font-semibold text-amber-700 hover:underline whitespace-nowrap"
              >
                <RefreshCw className="h-3 w-3" />
                Hubungkan Ulang Drive
              </button>
            )}
          </div>

          {/* Zone 3: Single Primary Session Action */}
          <div className="flex items-center gap-2 shrink-0">
            {!accessToken && (
              <button
                type="button"
                onClick={handleGoogleLogin}
                className="md:hidden inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-amber-300 bg-amber-50 px-2.5 text-xs font-medium text-amber-800 whitespace-nowrap"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Drive
              </button>
            )}

            {isBootstrappedAdmin && !picOverride && managedUsers.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  setPicLoginError('');
                  setPicModalOpen(true);
                }}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Masuk Sesi PIC
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
            onRequestReconnectDrive={handleGoogleLogin}
          />
        )}

        {activeProfile.role === 'viewer' && (
          <ViewerDashboard
            picProfile={activeProfile}
            accessToken={accessToken}
            submissions={submissions}
            workStages={workStages}
            onRequestReconnectDrive={handleGoogleLogin}
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
            onRequestReconnectDrive={handleGoogleLogin}
          />
        )}
      </div>

      {/* PIC Login Modal (Username & Password from User Management Table) */}
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
                  Masuk sebagai PIC (User / Viewer / Admin)
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

            <form onSubmit={handlePicCredentialLogin} className="mt-4 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Username
                </label>
                <input
                  type="text"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
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
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  required
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                />
              </div>

              {picLoginError && (
                <p className="text-xs font-medium text-red-700">{picLoginError}</p>
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
