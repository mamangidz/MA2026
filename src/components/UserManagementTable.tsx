import React, { useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Download,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FileSpreadsheet,
  KeyRound,
  Link as LinkIcon,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import {
  deleteDoc,
  doc,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { BOOTSTRAPPED_ADMIN_EMAIL, ManagedUser, UserRole } from '../types';
import {
  downloadCsvFile,
  exportUsersToCsv,
  ParsedCsvUserRow,
  parseUsersCsv,
} from '../lib/csvParser';
import { formatDevicePolicyLabel, getExpectedDevicePolicy } from '../lib/device';
import {
  db,
  FIREBASE_PROJECT_ID,
  handleFirestoreError,
  OperationType,
  provisionPasswordAccount,
  usernameToAuthEmail,
} from '../lib/firebase';
import { ConfirmDialog } from './ConfirmDialog';

interface UserManagementTableProps {
  users: ManagedUser[];
  currentUserUid: string;
  locations: string[];
}

export const UserManagementTable: React.FC<UserManagementTableProps> = ({
  users,
  currentUserUid,
  locations,
}) => {
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all');
  const [visiblePasswords, setVisiblePasswords] = useState<Record<string, boolean>>({});
  const [providerDisabledWarning, setProviderDisabledWarning] = useState(false);
  const [syncingAccounts, setSyncingAccounts] = useState(false);
  const [syncStatusMsg, setSyncStatusMsg] = useState('');

  // Add / Edit modal state
  const [formOpen, setFormOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<ManagedUser | null>(null);
  const [formLocation, setFormLocation] = useState(locations[0] || 'Jakarta');
  const [formPicName, setFormPicName] = useState('');
  const [formRole, setFormRole] = useState<UserRole>('user');
  const [formUsername, setFormUsername] = useState('');
  const [formPassword, setFormPassword] = useState('');
  const [formGoogleEmail, setFormGoogleEmail] = useState('');
  const [formActive, setFormActive] = useState(true);
  const [savingForm, setSavingForm] = useState(false);
  const [formError, setFormError] = useState('');

  // Import CSV / URL modal state
  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importCsvText, setImportCsvText] = useState('');
  const [parsedPreview, setParsedPreview] = useState<ParsedCsvUserRow[]>([]);
  const [importSkipped, setImportSkipped] = useState(0);
  const [importError, setImportError] = useState('');
  const [fetchingUrl, setFetchingUrl] = useState(false);
  const [importingRows, setImportingRows] = useState(false);
  const csvFileInputRef = useRef<HTMLInputElement | null>(null);

  // Delete confirmation state
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const collectAdminEmails = (extraAdmins: string[] = []): string[] => {
    const list = [
      BOOTSTRAPPED_ADMIN_EMAIL,
      ...users
        .filter((u) => u.active && u.role === 'admin')
        .flatMap((u) => [u.authEmail, u.googleEmail]),
      ...extraAdmins,
    ]
      .map((e) => (e || '').trim().toLowerCase())
      .filter(Boolean);
    return Array.from(new Set(list)).slice(0, 10);
  };

  const registerAdminRegistry = async (
    email: string,
    picName: string,
    active: boolean
  ) => {
    const clean = email.trim().toLowerCase();
    if (!clean) return;
    await setDoc(doc(db, 'admin_emails', clean), {
      email: clean,
      picName: picName.slice(0, 100),
      active,
      createdAt: serverTimestamp(),
      createdByUid: currentUserUid,
    });
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users
      .filter((u) => (roleFilter === 'all' ? true : u.role === roleFilter))
      .filter((u) => {
        if (!q) return true;
        return (
          u.location.toLowerCase().includes(q) ||
          u.picName.toLowerCase().includes(q) ||
          u.username.toLowerCase().includes(q) ||
          u.role.toLowerCase().includes(q) ||
          (u.googleEmail || '').toLowerCase().includes(q)
        );
      })
      .sort((a, b) => a.rowNumber - b.rowNumber);
  }, [users, roleFilter, search]);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormLocation(locations[0] || 'Jakarta');
    setFormPicName('');
    setFormRole('user');
    setFormUsername('');
    setFormPassword('');
    setFormGoogleEmail('');
    setFormActive(true);
    setFormError('');
    setFormOpen(true);
  };

  const openEditModal = (u: ManagedUser) => {
    setEditingUser(u);
    setFormLocation(u.location);
    setFormPicName(u.picName);
    setFormRole(u.role);
    setFormUsername(u.username);
    setFormPassword(u.password);
    setFormGoogleEmail(u.googleEmail || '');
    setFormActive(u.active);
    setFormError('');
    setFormOpen(true);
  };

  const handleSaveUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    const loc = formLocation.trim();
    const pic = formPicName.trim();
    const uname = formUsername.trim();
    const pwd = formPassword.trim();
    const gEmail = formGoogleEmail.trim().toLowerCase();

    if (!loc || !pic || !uname || !pwd) {
      setFormError('Lokasi, PIC, Username, dan Password wajib diisi.');
      return;
    }
    if (pwd.length < 6) {
      setFormError('Password minimal 6 karakter agar dapat digunakan untuk login.');
      return;
    }

    setSavingForm(true);
    try {
      const devicePolicy = getExpectedDevicePolicy(formRole);
      const prov = await provisionPasswordAccount(uname, pwd);
      if (prov.errorCode === 'auth/operation-not-allowed') {
        setProviderDisabledWarning(true);
      }

      const adminEmails = collectAdminEmails(
        formRole === 'admin' ? [prov.authEmail, gEmail] : []
      );

      if (editingUser) {
        const ref = doc(db, 'managed_users', editingUser.id);
        try {
          await updateDoc(ref, {
            rowNumber: editingUser.rowNumber,
            location: loc.slice(0, 80),
            picName: pic.slice(0, 100),
            role: formRole,
            username: uname.slice(0, 60),
            password: pwd.slice(0, 100),
            authEmail: prov.authEmail,
            authUid: prov.authUid || editingUser.authUid || '',
            googleEmail: gEmail.slice(0, 120),
            adminEmails,
            devicePolicy,
            active: formActive,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, `managed_users/${editingUser.id}`);
        }
      } else {
        const nextRowNum =
          users.length > 0 ? Math.max(...users.map((u) => u.rowNumber)) + 1 : 1;
        const id = `usr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
        const ref = doc(db, 'managed_users', id);
        try {
          await setDoc(ref, {
            id,
            rowNumber: nextRowNum,
            location: loc.slice(0, 80),
            picName: pic.slice(0, 100),
            role: formRole,
            username: uname.slice(0, 60),
            password: pwd.slice(0, 100),
            authEmail: prov.authEmail,
            authUid: prov.authUid,
            googleEmail: gEmail.slice(0, 120),
            adminEmails,
            devicePolicy,
            active: formActive,
            ownerUid: currentUserUid,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.CREATE, `managed_users/${id}`);
        }
      }

      if (formRole === 'admin') {
        await registerAdminRegistry(prov.authEmail, pic, formActive);
        if (gEmail) {
          await registerAdminRegistry(gEmail, pic, formActive);
        }
      }

      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Gagal menyimpan user.');
    } finally {
      setSavingForm(false);
    }
  };

  const handleSyncAllLoginAccounts = async () => {
    setSyncingAccounts(true);
    setSyncStatusMsg('');
    setProviderDisabledWarning(false);
    let syncedCount = 0;
    let disabledFound = false;

    try {
      const allAdmins = collectAdminEmails();
      for (const u of users) {
        const prov = await provisionPasswordAccount(u.username, u.password);
        if (prov.errorCode === 'auth/operation-not-allowed') {
          disabledFound = true;
          break;
        }
        if (prov.authUid) {
          syncedCount++;
          await updateDoc(doc(db, 'managed_users', u.id), {
            authEmail: prov.authEmail,
            authUid: prov.authUid,
            adminEmails: allAdmins,
            updatedAt: serverTimestamp(),
          });
        }
        if (u.role === 'admin') {
          await registerAdminRegistry(prov.authEmail, u.picName, u.active);
        }
      }

      if (disabledFound) {
        setProviderDisabledWarning(true);
        setSyncStatusMsg(
          'Sinkronisasi dihentikan karena provider Email/Password belum diaktifkan di Firebase Console.'
        );
      } else {
        setSyncStatusMsg(
          `${syncedCount} akun login berhasil disinkronkan untuk masuk dengan Username & Password.`
        );
      }
    } catch (err) {
      setSyncStatusMsg(
        err instanceof Error ? err.message : 'Gagal menyinkronkan akun.'
      );
    } finally {
      setSyncingAccounts(false);
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, 'managed_users', deleteTarget.id));
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `managed_users/${deleteTarget.id}`);
    } finally {
      setDeleting(false);
    }
  };

  const handleConfirmClearAll = async () => {
    setDeleting(true);
    try {
      const batch = writeBatch(db);
      users.forEach((u) => {
        batch.delete(doc(db, 'managed_users', u.id));
      });
      await batch.commit();
      setClearAllOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'managed_users');
    } finally {
      setDeleting(false);
    }
  };

  const handleParseText = (text: string) => {
    setImportCsvText(text);
    setImportError('');
    if (!text.trim()) {
      setParsedPreview([]);
      setImportSkipped(0);
      return;
    }
    const res = parseUsersCsv(text);
    setParsedPreview(res.rows);
    setImportSkipped(res.skippedLines);
  };

  const handleFetchFromUrl = async () => {
    if (!importUrl.trim()) {
      setImportError('Masukkan URL file CSV terlebih dahulu.');
      return;
    }
    setFetchingUrl(true);
    setImportError('');
    try {
      const response = await fetch(importUrl.trim());
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} saat mengambil data URL.`);
      }
      const text = await response.text();
      handleParseText(text);
    } catch (err) {
      setImportError(
        err instanceof Error
          ? `Gagal mengambil CSV dari URL (${err.message}). Anda dapat mengunduh file CSV lalu mengunggahnya atau menempelkan isinya langsung di bawah.`
          : 'Gagal mengambil data dari URL.'
      );
    } finally {
      setFetchingUrl(false);
    }
  };

  const handleCsvFileUpload = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = typeof reader.result === 'string' ? reader.result : '';
      handleParseText(text);
    };
    reader.readAsText(file);
  };

  const handleCommitImport = async () => {
    if (parsedPreview.length === 0) return;
    setImportingRows(true);
    setImportError('');
    try {
      const extraAdmins = parsedPreview
        .filter((r) => r.role === 'admin')
        .flatMap((r) => [usernameToAuthEmail(r.username), r.googleEmail]);
      const adminEmails = collectAdminEmails(extraAdmins);

      const batch = writeBatch(db);
      const startIndex =
        users.length > 0 ? Math.max(...users.map((u) => u.rowNumber)) : 0;

      for (let idx = 0; idx < parsedPreview.length; idx++) {
        const row = parsedPreview[idx];
        const prov = await provisionPasswordAccount(row.username, row.password);
        if (prov.errorCode === 'auth/operation-not-allowed') {
          setProviderDisabledWarning(true);
        }

        const id = `usr_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`;
        batch.set(doc(db, 'managed_users', id), {
          id,
          rowNumber: startIndex + idx + 1,
          location: row.location.slice(0, 80),
          picName: row.picName.slice(0, 100),
          role: row.role,
          username: row.username.slice(0, 60),
          password: row.password.slice(0, 100),
          authEmail: prov.authEmail,
          authUid: prov.authUid,
          googleEmail: row.googleEmail.slice(0, 120),
          adminEmails,
          devicePolicy: row.devicePolicy,
          active: true,
          ownerUid: currentUserUid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (row.role === 'admin') {
          await registerAdminRegistry(prov.authEmail, row.picName, true);
          if (row.googleEmail) {
            await registerAdminRegistry(row.googleEmail, row.picName, true);
          }
        }
      }

      await batch.commit();
      setImportOpen(false);
      setImportCsvText('');
      setImportUrl('');
      setParsedPreview([]);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'managed_users');
    } finally {
      setImportingRows(false);
    }
  };

  const handleDownloadBlankTemplate = () => {
    const template =
      'No,Nama Lokasi,PIC,Otorisasi,username,password,Email Google\n';
    downloadCsvFile('template_user_manajemen_kosong.csv', template);
  };

  const handleExportCurrentCsv = () => {
    const csv = exportUsersToCsv(filteredUsers);
    downloadCsvFile('data_user_manajemen.csv', csv);
  };

  return (
    <div className="space-y-4">
      {providerDisabledWarning && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-xs text-amber-950 space-y-2">
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="font-semibold">
                Aktifkan Login Email/Password di Firebase Console agar user bisa masuk dengan Username &amp; Password
              </p>
              <p className="text-amber-900">
                Buka Firebase Console → <strong>Authentication</strong> →{' '}
                <strong>Sign-in method</strong> → <strong>Add new provider</strong> →{' '}
                <strong>Email/Password</strong> → Aktifkan (Enable) → Save. Setelah aktif, klik tombol{' '}
                <strong>Sinkronkan Akun Login</strong> di bawah.
              </p>
              <a
                href={`https://console.firebase.google.com/project/${FIREBASE_PROJECT_ID}/authentication/providers`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline pt-1"
              >
                Buka Firebase Sign-in Method Settings
                <ExternalLink className="h-3 w-3" />
              </a>
            </div>
          </div>
        </div>
      )}

      {syncStatusMsg && (
        <div className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-xs font-medium text-slate-800">
          {syncStatusMsg}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Cari lokasi, PIC, username..."
              className="min-h-[40px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['all', 'user', 'viewer', 'admin'] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRoleFilter(r)}
                className={`min-h-[32px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                  roleFilter === r
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {r === 'all'
                  ? 'Semua'
                  : r === 'user'
                    ? 'User (Lapangan)'
                    : r === 'viewer'
                      ? 'Viewer (Lokasi)'
                      : 'Admin'}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleDownloadBlankTemplate}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Template Blank
          </button>

          {users.length > 0 && (
            <>
              <button
                type="button"
                disabled={syncingAccounts}
                onClick={handleSyncAllLoginAccounts}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${syncingAccounts ? 'animate-spin' : ''}`} />
                {syncingAccounts ? 'Menyinkronkan...' : 'Sinkronkan Login'}
              </button>

              <button
                type="button"
                onClick={handleExportCurrentCsv}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setImportError('');
              setImportOpen(true);
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
          >
            <Upload className="h-3.5 w-3.5" />
            Import CSV / URL
          </button>

          {users.length > 0 && (
            <button
              type="button"
              onClick={() => setClearAllOpen(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-medium text-red-700 hover:bg-red-50 whitespace-nowrap"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Kosongkan
            </button>
          )}

          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800 whitespace-nowrap"
          >
            <Plus className="h-3.5 w-3.5" />
            Tambah User
          </button>
        </div>
      </div>

      {/* Table Container */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                <th className="px-4 py-3 w-14">No</th>
                <th className="px-4 py-3">Nama Lokasi</th>
                <th className="px-4 py-3">PIC</th>
                <th className="px-4 py-3">Otorisasi</th>
                <th className="px-4 py-3">Username</th>
                <th className="px-4 py-3">Password</th>
                <th className="px-4 py-3">Status Login</th>
                <th className="px-4 py-3">Perangkat</th>
                <th className="px-4 py-3 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-6 py-12 text-center">
                    <p className="text-sm font-semibold text-slate-900">
                      {users.length === 0
                        ? 'Tabel User Management Kosong (Blank)'
                        : 'Tidak ada data user yang sesuai filter'}
                    </p>
                    <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
                      {users.length === 0
                        ? 'Tambahkan user dengan otorisasi User (HP Android), Viewer (PC Windows per lokasi), atau Admin (PC Windows), atau impor langsung dari file/URL CSV.'
                        : 'Ubah kata kunci pencarian atau pilih kategori otorisasi lain.'}
                    </p>
                    {users.length === 0 && (
                      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                        <button
                          type="button"
                          onClick={openCreateModal}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-blue-700 px-3.5 py-2 text-xs font-semibold text-white hover:bg-blue-800"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Tambah User Pertama
                        </button>
                        <button
                          type="button"
                          onClick={() => setImportOpen(true)}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Import dari CSV / URL
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u, idx) => {
                  const showPwd = !!visiblePasswords[u.id];
                  return (
                    <tr key={u.id} className="hover:bg-slate-50/70 transition-colors">
                      <td className="px-4 py-3 font-mono text-xs text-slate-500 tabular-nums">
                        {idx + 1}
                      </td>
                      <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">
                        {u.location}
                      </td>
                      <td className="px-4 py-3 text-slate-800 whitespace-nowrap">
                        {u.picName}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span
                          className={`text-xs font-semibold capitalize ${
                            u.role === 'admin'
                              ? 'text-blue-700'
                              : u.role === 'viewer'
                                ? 'text-amber-700'
                                : 'text-emerald-700'
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-800 whitespace-nowrap">
                        {u.username}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-700 whitespace-nowrap">
                        <div className="inline-flex items-center gap-1.5">
                          <span>{showPwd ? u.password : '••••••••'}</span>
                          <button
                            type="button"
                            onClick={() =>
                              setVisiblePasswords((prev) => ({
                                ...prev,
                                [u.id]: !prev[u.id],
                              }))
                            }
                            className="p-1 text-slate-400 hover:text-slate-700"
                            aria-label={showPwd ? 'Sembunyikan password' : 'Lihat password'}
                          >
                            {showPwd ? (
                              <EyeOff className="h-3.5 w-3.5" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs whitespace-nowrap">
                        {u.authUid ? (
                          <span className="inline-flex items-center gap-1 font-medium text-emerald-700">
                            <KeyRound className="h-3 w-3" />
                            Siap Login
                          </span>
                        ) : (
                          <span className="text-amber-700 font-medium">
                            Perlu Sinkronisasi
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-slate-600 whitespace-nowrap">
                        {formatDevicePolicyLabel(u.devicePolicy)}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <div className="inline-flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => openEditModal(u)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                            aria-label={`Edit ${u.picName}`}
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setDeleteTarget(u)}
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-700"
                            aria-label={`Hapus ${u.picName}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add / Edit User Modal */}
      {formOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                {editingUser ? 'Edit Data User' : 'Tambah User Baru'}
              </h3>
              <button
                type="button"
                onClick={() => setFormOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveUser} className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Nama Lokasi
                  </label>
                  <input
                    type="text"
                    list="location-suggestions"
                    value={formLocation}
                    onChange={(e) => setFormLocation(e.target.value)}
                    required
                    maxLength={80}
                    placeholder="Contoh: Jakarta"
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <datalist id="location-suggestions">
                    {locations.map((l) => (
                      <option key={l} value={l} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Otorisasi
                  </label>
                  <select
                    value={formRole}
                    onChange={(e) => setFormRole(e.target.value as UserRole)}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm"
                  >
                    <option value="user">User (Input Lapangan - HP Android)</option>
                    <option value="viewer">Viewer (Lihat Lokasi - PC Windows)</option>
                    <option value="admin">Admin (Kelola &amp; Validasi - PC Windows)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Nama PIC
                </label>
                <input
                  type="text"
                  value={formPicName}
                  onChange={(e) => setFormPicName(e.target.value)}
                  required
                  maxLength={100}
                  placeholder="Nama lengkap penanggung jawab"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Username
                  </label>
                  <input
                    type="text"
                    value={formUsername}
                    onChange={(e) => setFormUsername(e.target.value)}
                    required
                    maxLength={60}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Password (min. 6 karakter)
                  </label>
                  <input
                    type="text"
                    value={formPassword}
                    onChange={(e) => setFormPassword(e.target.value)}
                    required
                    minLength={6}
                    maxLength={100}
                    className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 font-mono text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Email Google (Opsional)
                </label>
                <input
                  type="email"
                  value={formGoogleEmail}
                  onChange={(e) => setFormGoogleEmail(e.target.value)}
                  maxLength={120}
                  placeholder="contoh@gmail.com"
                  className="min-h-[40px] w-full rounded-lg border border-slate-300 px-3 text-sm"
                />
              </div>

              <div className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>
                  Kebijakan Perangkat:{' '}
                  <strong>
                    {formatDevicePolicyLabel(getExpectedDevicePolicy(formRole))}
                  </strong>
                </span>
                <label className="inline-flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={formActive}
                    onChange={(e) => setFormActive(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-blue-700"
                  />
                  <span>Akun Aktif</span>
                </label>
              </div>

              {formError && (
                <p className="text-xs font-medium text-red-700">{formError}</p>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="submit"
                  disabled={savingForm}
                  className="min-h-[40px] rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {savingForm ? 'Menyimpan...' : 'Simpan User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Import CSV / URL Modal */}
      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-6 shadow-xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-900">
                Import Tabel User Management (CSV / Data URL)
              </h3>
              <button
                type="button"
                onClick={() => setImportOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-4 space-y-4">
              {/* URL Fetch */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Ambil dari URL CSV (Google Sheets CSV / URL Publik)
                </label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <LinkIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="url"
                      value={importUrl}
                      onChange={(e) => setImportUrl(e.target.value)}
                      placeholder="https://..."
                      className="min-h-[40px] w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleFetchFromUrl}
                    disabled={fetchingUrl}
                    className="min-h-[40px] rounded-lg border border-slate-300 bg-slate-50 px-3.5 text-xs font-medium text-slate-800 hover:bg-slate-100 whitespace-nowrap"
                  >
                    {fetchingUrl ? 'Mengambil...' : 'Ambil Data'}
                  </button>
                </div>
              </div>

              {/* File Upload */}
              <div className="flex items-center justify-between rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3">
                <div className="text-xs text-slate-600">
                  Atau pilih file <strong className="text-slate-900">.csv</strong> dari komputer Anda
                </div>
                <input
                  ref={csvFileInputRef}
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => handleCsvFileUpload(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => csvFileInputRef.current?.click()}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 text-xs font-medium text-slate-800 hover:bg-slate-50"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Pilih File CSV
                </button>
              </div>

              {/* Paste CSV */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1">
                  Tempel Data CSV (No, Nama Lokasi, PIC, Otorisasi, username, password)
                </label>
                <textarea
                  rows={5}
                  value={importCsvText}
                  onChange={(e) => handleParseText(e.target.value)}
                  placeholder="No,Nama Lokasi,PIC,Otorisasi,username,password"
                  className="w-full rounded-lg border border-slate-300 p-3 font-mono text-xs text-slate-900"
                />
              </div>

              {importError && (
                <p className="rounded-lg bg-red-50 p-3 text-xs text-red-800">
                  {importError}
                </p>
              )}

              {parsedPreview.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Siap diimpor: <strong className="text-slate-900">{parsedPreview.length}</strong> baris user
                    </span>
                    {importSkipped > 0 && (
                      <span className="text-amber-700">
                        {importSkipped} baris tidak lengkap dilewati
                      </span>
                    )}
                  </div>
                  <div className="max-h-48 overflow-y-auto rounded-lg border border-slate-200">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 text-slate-600 border-b border-slate-200">
                        <tr>
                          <th className="px-3 py-2">Lokasi</th>
                          <th className="px-3 py-2">PIC</th>
                          <th className="px-3 py-2">Otorisasi</th>
                          <th className="px-3 py-2">Username</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {parsedPreview.map((row, idx) => (
                          <tr key={idx}>
                            <td className="px-3 py-1.5 font-medium">{row.location}</td>
                            <td className="px-3 py-1.5">{row.picName}</td>
                            <td className="px-3 py-1.5 capitalize">{row.role}</td>
                            <td className="px-3 py-1.5 font-mono">{row.username}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setImportOpen(false)}
                  className="min-h-[40px] rounded-lg border border-slate-200 px-4 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
                >
                  Batal
                </button>
                <button
                  type="button"
                  disabled={parsedPreview.length === 0 || importingRows}
                  onClick={handleCommitImport}
                  className="min-h-[40px] rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
                >
                  {importingRows
                    ? 'Mengimpor...'
                    : `Impor ${parsedPreview.length} User`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Data User"
        description={`Apakah Anda yakin ingin menghapus akun ${deleteTarget?.picName} (${deleteTarget?.location} · ${deleteTarget?.role})? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus User"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={clearAllOpen}
        title="Kosongkan Tabel User Management"
        description={`Apakah Anda yakin ingin menghapus seluruh ${users.length} baris user agar tabel kembali kosong (blank)?`}
        confirmLabel="Kosongkan Semua"
        destructive
        loading={deleting}
        onConfirm={handleConfirmClearAll}
        onCancel={() => setClearAllOpen(false)}
      />
    </div>
  );
};
