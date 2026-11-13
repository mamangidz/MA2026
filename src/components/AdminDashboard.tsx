import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  List,
  MapPin,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Trash2,
  Users,
  X,
  XCircle,
} from 'lucide-react';
import { deleteDoc, doc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  ActivePicProfile,
  BOOTSTRAPPED_ADMIN_EMAIL,
  DRIVE_ROOT_FOLDER_ID,
  DRIVE_ROOT_FOLDER_URL,
  ManagedUser,
  PhotoCategory,
  PhotoSubmission,
  ValidationStatus,
} from '../types';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { deleteDriveFile } from '../lib/drive';
import { checkDeviceCompliance, detectDeviceEnvironment } from '../lib/device';
import { DrivePhotoPreview } from './DrivePhotoPreview';
import { ValidationStatusLabel } from './ValidationBadge';
import { UserManagementTable } from './UserManagementTable';
import { FieldCaptureView } from './FieldCaptureView';
import { ConfirmDialog } from './ConfirmDialog';

interface AdminDashboardProps {
  picProfile: ActivePicProfile;
  userUid: string;
  userEmail: string;
  accessToken: string | null;
  submissions: PhotoSubmission[];
  managedUsers: ManagedUser[];
  locations: string[];
  workStages: string[];
  onRequestReconnectDrive: () => Promise<string | null>;
}

type AdminTab = 'validation' | 'users' | 'taxonomy' | 'capture';

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  picProfile,
  userUid,
  userEmail,
  accessToken,
  submissions,
  managedUsers,
  locations,
  workStages,
  onRequestReconnectDrive,
}) => {
  const [activeTab, setActiveTab] = useState<AdminTab>('validation');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [statusFilter, setStatusFilter] = useState<'all' | ValidationStatus>('all');
  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PhotoCategory>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const [selectedSubmission, setSelectedSubmission] =
    useState<PhotoSubmission | null>(null);
  const [validationNoteInput, setValidationNoteInput] = useState<string>('');
  const [validating, setValidating] = useState<boolean>(false);
  const [deleteTarget, setDeleteTarget] = useState<PhotoSubmission | null>(null);
  const [deleting, setDeleting] = useState<boolean>(false);

  // Taxonomy editor state
  const [editLocations, setEditLocations] = useState<string[]>(locations);
  const [editStages, setEditStages] = useState<string[]>(workStages);
  const [newLocationInput, setNewLocationInput] = useState('');
  const [newStageInput, setNewStageInput] = useState('');
  const [savingTaxonomy, setSavingTaxonomy] = useState(false);
  const [taxonomySavedMsg, setTaxonomySavedMsg] = useState('');

  const deviceEnv = useMemo(() => detectDeviceEnvironment(), []);
  const compliance = useMemo(
    () => checkDeviceCompliance('admin', deviceEnv),
    [deviceEnv]
  );

  useEffect(() => {
    setEditLocations(locations);
  }, [locations]);

  useEffect(() => {
    setEditStages(workStages);
  }, [workStages]);

  // Keep viewerEmails synced on submissions so regional Viewers can query their location
  useEffect(() => {
    if (managedUsers.length === 0 || submissions.length === 0) return;

    submissions.forEach(async (sub) => {
      const expectedViewers = Array.from(
        new Set(
          managedUsers
            .filter(
              (u) =>
                u.active &&
                u.role === 'viewer' &&
                u.location.toLowerCase() === sub.location.toLowerCase()
            )
            .flatMap((u) => [u.authEmail, u.googleEmail])
            .map((e) => (e || '').trim().toLowerCase())
            .filter(Boolean)
        )
      ).slice(0, 10);

      const expectedAdmins = Array.from(
        new Set([
          BOOTSTRAPPED_ADMIN_EMAIL,
          ...managedUsers
            .filter((u) => u.active && u.role === 'admin')
            .flatMap((u) => [u.authEmail, u.googleEmail])
            .map((e) => (e || '').trim().toLowerCase())
            .filter(Boolean),
        ])
      ).slice(0, 10);

      const currentViewers = [...(sub.viewerEmails || [])].sort().join(',');
      const targetViewers = [...expectedViewers].sort().join(',');
      const currentAdmins = [...(sub.adminEmails || [])].sort().join(',');
      const targetAdmins = [...expectedAdmins].sort().join(',');

      if (currentViewers !== targetViewers || currentAdmins !== targetAdmins) {
        try {
          await updateDoc(doc(db, 'photo_submissions', sub.id), {
            viewerEmails: expectedViewers,
            adminEmails: expectedAdmins,
            updatedAt: serverTimestamp(),
          });
        } catch {
          // Non-fatal background sync
        }
      }
    });
  }, [managedUsers, submissions]);

  const stats = useMemo(() => {
    return {
      total: submissions.length,
      pending: submissions.filter((s) => s.validationStatus === 'pending').length,
      approved: submissions.filter((s) => s.validationStatus === 'approved').length,
      rejected: submissions.filter((s) => s.validationStatus === 'rejected').length,
    };
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return submissions
      .filter((s) =>
        statusFilter === 'all' ? true : s.validationStatus === statusFilter
      )
      .filter((s) =>
        locationFilter === 'all' ? true : s.location === locationFilter
      )
      .filter((s) =>
        categoryFilter === 'all' ? true : s.category === categoryFilter
      )
      .filter((s) => {
        if (!q) return true;
        return (
          s.location.toLowerCase().includes(q) ||
          s.workStage.toLowerCase().includes(q) ||
          s.picName.toLowerCase().includes(q) ||
          s.driveFileName.toLowerCase().includes(q) ||
          s.driveFolderName.toLowerCase().includes(q) ||
          s.notes.toLowerCase().includes(q)
        );
      });
  }, [submissions, statusFilter, locationFilter, categoryFilter, searchQuery]);

  const openInspector = (sub: PhotoSubmission) => {
    setSelectedSubmission(sub);
    setValidationNoteInput(sub.validationNote || '');
  };

  const handleValidate = async (newStatus: 'approved' | 'rejected') => {
    if (!selectedSubmission) return;
    setValidating(true);
    try {
      const ref = doc(db, 'photo_submissions', selectedSubmission.id);
      const adminEmails = Array.from(
        new Set([
          BOOTSTRAPPED_ADMIN_EMAIL,
          ...(selectedSubmission.adminEmails || []),
          userEmail.toLowerCase(),
        ])
      ).slice(0, 10);

      await updateDoc(ref, {
        validationStatus: newStatus,
        validationNote: validationNoteInput.trim().slice(0, 500),
        validatedBy: picProfile.picName,
        validatedAt: new Date().toISOString().slice(0, 19).replace('T', ' '),
        adminEmails,
        updatedAt: serverTimestamp(),
      });
      setSelectedSubmission(null);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.UPDATE,
        `photo_submissions/${selectedSubmission.id}`
      );
    } finally {
      setValidating(false);
    }
  };

  const handleConfirmDeleteSubmission = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      let token = accessToken;
      if (!token) {
        token = await onRequestReconnectDrive();
      }
      if (token) {
        await deleteDriveFile(token, deleteTarget.driveFileId);
      }
      await deleteDoc(doc(db, 'photo_submissions', deleteTarget.id));
      if (selectedSubmission?.id === deleteTarget.id) {
        setSelectedSubmission(null);
      }
      setDeleteTarget(null);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `photo_submissions/${deleteTarget.id}`
      );
    } finally {
      setDeleting(false);
    }
  };

  const handleSaveTaxonomy = async () => {
    setSavingTaxonomy(true);
    setTaxonomySavedMsg('');
    try {
      await setDoc(doc(db, 'config', 'app_taxonomy'), {
        locations: editLocations.slice(0, 50),
        workStages: editStages.slice(0, 50),
        driveRootFolderId: DRIVE_ROOT_FOLDER_ID,
        updatedAt: serverTimestamp(),
        updatedByUid: userUid,
      });
      setTaxonomySavedMsg('Pengaturan lokasi dan tahapan pekerjaan berhasil disimpan.');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'config/app_taxonomy');
    } finally {
      setSavingTaxonomy(false);
    }
  };

  const navItems: { id: AdminTab; label: string; icon: React.ReactNode; count?: number }[] = [
    {
      id: 'validation',
      label: 'Validasi Foto',
      icon: <ShieldCheck className="h-4 w-4" />,
      count: stats.pending,
    },
    {
      id: 'users',
      label: 'Manajemen User',
      icon: <Users className="h-4 w-4" />,
      count: managedUsers.length,
    },
    {
      id: 'taxonomy',
      label: 'Lokasi & Tahapan',
      icon: <Settings className="h-4 w-4" />,
    },
    {
      id: 'capture',
      label: 'Input Lapangan (HP)',
      icon: <Camera className="h-4 w-4" />,
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col lg:flex-row">
      {/* Desktop Sidebar */}
      <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:min-h-[calc(100vh-65px)] lg:w-64 lg:border-b-0 lg:border-r">
        <div className="p-4 space-y-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-900">
              Panel Admin · {picProfile.picName}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {compliance.expectedLabel} ({deviceEnv.label})
            </p>
          </div>

          <nav className="flex flex-row gap-1 overflow-x-auto lg:flex-col">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`flex min-h-[40px] items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === item.id
                    ? 'bg-blue-50 text-blue-800'
                    : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {item.icon}
                  {item.label}
                </span>
                {typeof item.count === 'number' && (
                  <span className="font-mono text-xs tabular-nums text-slate-500">
                    {item.count}
                  </span>
                )}
              </button>
            ))}
          </nav>

          <div className="hidden lg:block border-t border-slate-100 pt-4">
            <a
              href={DRIVE_ROOT_FOLDER_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              <span className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-blue-700" />
                Folder Google Drive
              </span>
              <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
            </a>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {activeTab === 'validation' && (
          <div className="p-4 sm:p-6 space-y-6">
            {/* Header */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  Validasi Foto Peralatan &amp; Dokumen
                </h1>
                <p className="mt-0.5 text-xs text-slate-500">
                  Periksa kelengkapan foto lapangan, stempel waktu, koordinat GPS, dan validasi kesesuaian.
                </p>
              </div>
              <a
                href={DRIVE_ROOT_FOLDER_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 self-start sm:self-auto whitespace-nowrap"
              >
                <FolderOpen className="h-4 w-4 text-blue-700" />
                Buka Root Google Drive
                <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
              </a>
            </div>

            {/* 4-column Summary Metrics */}
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="text-xs font-medium text-slate-500">Total Foto Masuk</span>
                <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                  {stats.total}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="text-xs font-medium text-amber-700">Menunggu Validasi</span>
                <p className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums">
                  {stats.pending}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="text-xs font-medium text-emerald-700">Disetujui (Valid)</span>
                <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                  {stats.approved}
                </p>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <span className="text-xs font-medium text-red-700">Ditolak</span>
                <p className="mt-1 font-mono text-2xl font-bold text-red-700 tabular-nums">
                  {stats.rejected}
                </p>
              </div>
            </div>

            {/* Filters Bar */}
            <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  {(['all', 'pending', 'approved', 'rejected'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      onClick={() => setStatusFilter(st)}
                      className={`min-h-[34px] rounded-md px-3 text-xs font-medium transition-colors whitespace-nowrap ${
                        statusFilter === st
                          ? 'bg-white text-slate-900 shadow-xs'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {st === 'all'
                        ? 'Semua'
                        : st === 'pending'
                          ? 'Menunggu'
                          : st === 'approved'
                            ? 'Disetujui'
                            : 'Ditolak'}
                    </button>
                  ))}
                </div>

                <select
                  value={locationFilter}
                  onChange={(e) => setLocationFilter(e.target.value)}
                  className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800"
                >
                  <option value="all">Semua Lokasi</option>
                  {locations.map((loc) => (
                    <option key={loc} value={loc}>
                      {loc}
                    </option>
                  ))}
                </select>

                <select
                  value={categoryFilter}
                  onChange={(e) =>
                    setCategoryFilter(e.target.value as 'all' | PhotoCategory)
                  }
                  className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800"
                >
                  <option value="all">Semua Kategori</option>
                  <option value="Peralatan">Peralatan</option>
                  <option value="Dokumen">Dokumen</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <div className="relative flex-1 sm:w-64">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Cari tahapan, PIC, file..."
                    className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setViewMode('table')}
                    className={`rounded-md p-1.5 ${
                      viewMode === 'table'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                    aria-label="Tampilan Tabel"
                  >
                    <List className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    className={`rounded-md p-1.5 ${
                      viewMode === 'grid'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                    aria-label="Tampilan Grid"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* Data View */}
            {filteredSubmissions.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
                <p className="text-sm font-semibold text-slate-900">
                  Belum ada foto pada filter ini
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Foto yang dikirimkan oleh User lapangan akan langsung muncul di sini untuk divalidasi.
                </p>
              </div>
            ) : viewMode === 'table' ? (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                        <th className="px-4 py-3">Lokasi &amp; Tahapan</th>
                        <th className="px-4 py-3">Kategori</th>
                        <th className="px-4 py-3">PIC Lapangan</th>
                        <th className="px-4 py-3">Waktu Pengambilan</th>
                        <th className="px-4 py-3">Koordinat GPS</th>
                        <th className="px-4 py-3">Status</th>
                        <th className="px-4 py-3 text-right">Aksi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredSubmissions.map((sub) => (
                        <tr
                          key={sub.id}
                          className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                          onClick={() => openInspector(sub)}
                        >
                          <td className="px-4 py-3">
                            <p className="font-semibold text-slate-900">{sub.location}</p>
                            <p className="text-xs text-slate-500">{sub.workStage}</p>
                          </td>
                          <td className="px-4 py-3 text-xs font-medium text-slate-700 whitespace-nowrap">
                            {sub.category}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-xs font-medium text-slate-900">
                              {sub.picName}
                            </p>
                            <p className="text-xs text-slate-500">{sub.devicePlatform}</p>
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {sub.capturedDate} · {sub.capturedTime}
                          </td>
                          <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                            {sub.latitude.toFixed(5)}, {sub.longitude.toFixed(5)}
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <ValidationStatusLabel status={sub.validationStatus} />
                          </td>
                          <td
                            className="px-4 py-3 text-right whitespace-nowrap"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <button
                              type="button"
                              onClick={() => openInspector(sub)}
                              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-800 hover:bg-slate-100"
                            >
                              Periksa &amp; Validasi
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {filteredSubmissions.map((sub) => (
                  <div
                    key={sub.id}
                    onClick={() => openInspector(sub)}
                    className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-blue-300 space-y-3"
                  >
                    <DrivePhotoPreview
                      fileId={sub.driveFileId}
                      fileName={sub.driveFileName}
                      webViewLink={sub.driveWebViewLink}
                      accessToken={accessToken}
                      onRequestReconnectDrive={onRequestReconnectDrive}
                    />
                    <div className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <ValidationStatusLabel status={sub.validationStatus} />
                        <span className="text-xs font-medium text-slate-500">
                          {sub.category}
                        </span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-900">
                        {sub.location} · {sub.workStage}
                      </h3>
                      <p className="text-xs text-slate-600">
                        PIC: {sub.picName} ·{' '}
                        <span className="font-mono tabular-nums">
                          {sub.capturedDate} {sub.capturedTime}
                        </span>
                      </p>
                      <p className="text-xs font-mono text-slate-500 tabular-nums">
                        GPS: {sub.latitude.toFixed(5)}, {sub.longitude.toFixed(5)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === 'users' && (
          <div className="p-4 sm:p-6 space-y-5">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Manajemen User &amp; Otorisasi
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Kelola otorisasi User (HP Android lapangan), Viewer (PC Windows per lokasi), dan Admin (PC Windows).
              </p>
            </div>
            <UserManagementTable
              users={managedUsers}
              currentUserUid={userUid}
              locations={locations}
            />
          </div>
        )}

        {activeTab === 'taxonomy' && (
          <div className="p-4 sm:p-6 space-y-6 max-w-4xl">
            <div>
              <h1 className="text-xl font-bold tracking-tight text-slate-900">
                Pengaturan Lokasi &amp; Tahapan Pekerjaan
              </h1>
              <p className="mt-0.5 text-xs text-slate-500">
                Daftar ini digunakan untuk penamaan folder otomatis dan nama file foto di Google Drive.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {/* Locations Editor */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <h2 className="text-sm font-semibold text-slate-900">Daftar Lokasi</h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newLocationInput}
                    onChange={(e) => setNewLocationInput(e.target.value)}
                    placeholder="Tambah lokasi baru..."
                    className="min-h-[38px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = newLocationInput.trim();
                      if (val && !editLocations.includes(val)) {
                        setEditLocations([...editLocations, val]);
                        setNewLocationInput('');
                      }
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah
                  </button>
                </div>
                <ul className="divide-y divide-slate-100">
                  {editLocations.map((loc) => (
                    <li
                      key={loc}
                      className="flex items-center justify-between py-2 text-sm text-slate-800"
                    >
                      <span>{loc}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditLocations(editLocations.filter((x) => x !== loc))
                        }
                        className="text-xs text-red-700 hover:underline"
                      >
                        Hapus
                      </button>
                    </li>
                  ))}
                </ul>
              </div>

              {/* Work Stages Editor */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-4">
                <h2 className="text-sm font-semibold text-slate-900">
                  Tahapan Pekerjaan
                </h2>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newStageInput}
                    onChange={(e) => setNewStageInput(e.target.value)}
                    placeholder="Tambah tahapan pekerjaan..."
                    className="min-h-[38px] flex-1 rounded-lg border border-slate-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const val = newStageInput.trim();
                      if (val && !editStages.includes(val)) {
                        setEditStages([...editStages, val]);
                        setNewStageInput('');
                      }
                    }}
                    className="inline-flex min-h-[38px] items-center gap-1 rounded-lg bg-slate-900 px-3 text-xs font-medium text-white hover:bg-slate-800"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Tambah
                  </button>
                </div>
                <ul className="divide-y divide-slate-100">
                  {editStages.map((stage) => (
                    <li
                      key={stage}
                      className="flex items-center justify-between py-2 text-sm text-slate-800"
                    >
                      <span>{stage}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setEditStages(editStages.filter((x) => x !== stage))
                        }
                        className="text-xs text-red-700 hover:underline"
                      >
                        Hapus
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-600">
                Root Folder Google Drive:{' '}
                <a
                  href={DRIVE_ROOT_FOLDER_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono font-medium text-blue-700 hover:underline"
                >
                  {DRIVE_ROOT_FOLDER_ID}
                </a>
              </div>
              <button
                type="button"
                disabled={savingTaxonomy}
                onClick={handleSaveTaxonomy}
                className="min-h-[40px] rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800 disabled:opacity-50"
              >
                {savingTaxonomy ? 'Menyimpan...' : 'Simpan Pengaturan'}
              </button>
            </div>

            {taxonomySavedMsg && (
              <p className="text-xs font-medium text-emerald-700">{taxonomySavedMsg}</p>
            )}
          </div>
        )}

        {activeTab === 'capture' && (
          <FieldCaptureView
            picProfile={picProfile}
            userUid={userUid}
            userEmail={userEmail}
            accessToken={accessToken}
            locations={locations}
            workStages={workStages}
            submissions={submissions}
            managedUsers={managedUsers}
            onRequestReconnectDrive={onRequestReconnectDrive}
          />
        )}
      </main>

      {/* Photo Inspector Modal */}
      {selectedSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-4xl max-h-[92vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Inspeksi &amp; Validasi Foto Lapangan
                </h3>
                <p className="text-xs text-slate-500">
                  {selectedSubmission.location} · {selectedSubmission.workStage}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 gap-6 p-6 lg:grid-cols-12">
              <div className="lg:col-span-7 space-y-3">
                <DrivePhotoPreview
                  fileId={selectedSubmission.driveFileId}
                  fileName={selectedSubmission.driveFileName}
                  webViewLink={selectedSubmission.driveWebViewLink}
                  accessToken={accessToken}
                  onRequestReconnectDrive={onRequestReconnectDrive}
                />
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-600">
                  <span className="font-mono break-all">
                    Folder: {selectedSubmission.driveFolderName}
                  </span>
                  <a
                    href={selectedSubmission.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-semibold text-blue-700 hover:underline whitespace-nowrap"
                  >
                    Buka Asli di Google Drive
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>

              <div className="lg:col-span-5 space-y-4">
                <div className="space-y-2.5 text-xs border-b border-slate-100 pb-4">
                  <div className="flex justify-between">
                    <span className="text-slate-500">Status Saat Ini</span>
                    <ValidationStatusLabel status={selectedSubmission.validationStatus} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Kategori</span>
                    <span className="font-semibold text-slate-900">
                      {selectedSubmission.category}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">PIC &amp; Perangkat</span>
                    <span className="font-medium text-slate-900">
                      {selectedSubmission.picName} ({selectedSubmission.devicePlatform})
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Tanggal Kegiatan</span>
                    <span className="font-mono text-slate-900 tabular-nums">
                      {selectedSubmission.activityDate}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500">Jam &amp; Tanggal Foto</span>
                    <span className="font-mono text-slate-900 tabular-nums">
                      {selectedSubmission.capturedDate} {selectedSubmission.capturedTime}
                    </span>
                  </div>
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-slate-500">Lokasi GPS</span>
                    <div className="text-right">
                      <p className="font-mono text-slate-900 tabular-nums">
                        {selectedSubmission.latitude.toFixed(6)},{' '}
                        {selectedSubmission.longitude.toFixed(6)}
                      </p>
                      <a
                        href={`https://www.google.com/maps?q=${selectedSubmission.latitude},${selectedSubmission.longitude}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-blue-700 hover:underline mt-0.5"
                      >
                        <MapPin className="h-3 w-3" />
                        Lihat di Google Maps
                      </a>
                    </div>
                  </div>
                  {selectedSubmission.notes && (
                    <div className="pt-1">
                      <span className="text-slate-500 block mb-1">Keterangan Lapangan</span>
                      <p className="rounded-lg bg-slate-50 p-2.5 text-slate-800">
                        {selectedSubmission.notes}
                      </p>
                    </div>
                  )}
                </div>

                {/* Validation Controls */}
                <div className="space-y-3">
                  <label className="block text-xs font-medium text-slate-700">
                    Catatan Validasi Admin
                  </label>
                  <textarea
                    rows={3}
                    maxLength={500}
                    value={validationNoteInput}
                    onChange={(e) => setValidationNoteInput(e.target.value)}
                    placeholder="Tambahkan catatan validasi atau alasan penolakan..."
                    className="w-full rounded-lg border border-slate-300 p-2.5 text-xs text-slate-900"
                  />

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={validating}
                      onClick={() => handleValidate('approved')}
                      className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                      Setujui (Valid)
                    </button>
                    <button
                      type="button"
                      disabled={validating}
                      onClick={() => handleValidate('rejected')}
                      className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-lg bg-red-700 px-3 text-xs font-semibold text-white hover:bg-red-800 disabled:opacity-50"
                    >
                      <XCircle className="h-4 w-4" />
                      Tolak Foto
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => setDeleteTarget(selectedSubmission)}
                    className="inline-flex min-h-[38px] w-full items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 text-xs font-medium text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Hapus Foto dari Drive &amp; Database
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title="Hapus Foto dari Google Drive"
        description={`Apakah Anda yakin ingin menghapus file "${deleteTarget?.driveFileName}" secara permanen dari Google Drive dan database? Tindakan ini tidak dapat dibatalkan.`}
        confirmLabel="Hapus Permanen"
        destructive
        loading={deleting}
        onConfirm={handleConfirmDeleteSubmission}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
};
