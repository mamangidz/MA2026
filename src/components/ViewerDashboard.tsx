import React, { useMemo, useState } from 'react';
import {
  ExternalLink,
  FolderOpen,
  LayoutGrid,
  List,
  Lock,
  MapPin,
  Monitor,
  Search,
  X,
} from 'lucide-react';
import {
  ActivePicProfile,
  DRIVE_ROOT_FOLDER_URL,
  PhotoCategory,
  PhotoSubmission,
  ValidationStatus,
} from '../types';
import { checkDeviceCompliance, detectDeviceEnvironment } from '../lib/device';
import { DrivePhotoPreview } from './DrivePhotoPreview';
import { ValidationStatusLabel } from './ValidationBadge';

interface ViewerDashboardProps {
  picProfile: ActivePicProfile;
  accessToken: string | null;
  submissions: PhotoSubmission[];
  workStages: string[];
  onRequestReconnectDrive: () => Promise<string | null>;
}

export const ViewerDashboard: React.FC<ViewerDashboardProps> = ({
  picProfile,
  accessToken,
  submissions,
  workStages,
  onRequestReconnectDrive,
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'table'>('grid');
  const [statusFilter, setStatusFilter] = useState<'all' | ValidationStatus>('all');
  const [categoryFilter, setCategoryFilter] = useState<'all' | PhotoCategory>('all');
  const [stageFilter, setStageFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedSubmission, setSelectedSubmission] =
    useState<PhotoSubmission | null>(null);

  const deviceEnv = useMemo(() => detectDeviceEnvironment(), []);
  const compliance = useMemo(
    () => checkDeviceCompliance('viewer', deviceEnv),
    [deviceEnv]
  );

  // Strict location scoping: viewer can ONLY view data matching their assigned location
  const locationSubmissions = useMemo(
    () =>
      submissions.filter(
        (s) => s.location.toLowerCase() === picProfile.location.toLowerCase()
      ),
    [submissions, picProfile.location]
  );

  const stats = useMemo(
    () => ({
      total: locationSubmissions.length,
      approved: locationSubmissions.filter((s) => s.validationStatus === 'approved')
        .length,
      pending: locationSubmissions.filter((s) => s.validationStatus === 'pending')
        .length,
    }),
    [locationSubmissions]
  );

  const filteredSubmissions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return locationSubmissions
      .filter((s) =>
        statusFilter === 'all' ? true : s.validationStatus === statusFilter
      )
      .filter((s) =>
        categoryFilter === 'all' ? true : s.category === categoryFilter
      )
      .filter((s) => (stageFilter === 'all' ? true : s.workStage === stageFilter))
      .filter((s) => {
        if (!q) return true;
        return (
          s.workStage.toLowerCase().includes(q) ||
          s.picName.toLowerCase().includes(q) ||
          s.driveFileName.toLowerCase().includes(q) ||
          s.notes.toLowerCase().includes(q)
        );
      });
  }, [locationSubmissions, statusFilter, categoryFilter, stageFilter, searchQuery]);

  return (
    <div className="mx-auto w-full max-w-[1440px] p-4 sm:p-6 space-y-6">
      {/* Location-Locked Header */}
      <div className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700">
              <Lock className="h-3.5 w-3.5" />
              Akses Viewer Terkunci Lokasi: {picProfile.location}
            </span>
            <span aria-hidden="true" className="text-slate-300">
              ·
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-slate-500">
              <Monitor className="h-3.5 w-3.5" />
              {compliance.expectedLabel} ({deviceEnv.label})
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900">
            Dokumentasi Lapangan Wilayah {picProfile.location}
          </h1>
          <p className="text-xs text-slate-500">
            PIC Viewer: {picProfile.picName} · Anda hanya dapat melihat foto peralatan dan dokumen dari lokasi {picProfile.location}.
          </p>
        </div>

        <a
          href={DRIVE_ROOT_FOLDER_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-[40px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 self-start sm:self-center whitespace-nowrap"
        >
          <FolderOpen className="h-4 w-4 text-blue-700" />
          Buka Folder Drive
          <ExternalLink className="h-3.5 w-3.5 text-slate-400" />
        </a>
      </div>

      {/* Location Summary KPIs */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs font-medium text-slate-500">
            Total Foto ({picProfile.location})
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
            {stats.total}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs font-medium text-emerald-700">
            Sudah Divalidasi (Disetujui)
          </span>
          <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
            {stats.approved}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <span className="text-xs font-medium text-amber-700">Menunggu Validasi</span>
          <p className="mt-1 font-mono text-2xl font-bold text-amber-700 tabular-nums">
            {stats.pending}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            {(['all', 'approved', 'pending', 'rejected'] as const).map((st) => (
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
                  : st === 'approved'
                    ? 'Disetujui'
                    : st === 'pending'
                      ? 'Menunggu'
                      : 'Ditolak'}
              </button>
            ))}
          </div>

          <select
            value={stageFilter}
            onChange={(e) => setStageFilter(e.target.value)}
            className="min-h-[38px] rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-800"
          >
            <option value="all">Semua Tahapan</option>
            {workStages.map((stage) => (
              <option key={stage} value={stage}>
                {stage}
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
              placeholder="Cari tahapan, PIC, keterangan..."
              className="min-h-[38px] w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
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
          </div>
        </div>
      </div>

      {/* Content */}
      {filteredSubmissions.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center">
          <p className="text-sm font-semibold text-slate-900">
            Belum ada data foto untuk lokasi {picProfile.location}
          </p>
          <p className="mt-1 text-xs text-slate-500">
            Foto peralatan dan dokumen yang dikirimkan PIC lapangan di {picProfile.location} akan tampil di sini.
          </p>
        </div>
      ) : viewMode === 'grid' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredSubmissions.map((sub) => (
            <div
              key={sub.id}
              onClick={() => setSelectedSubmission(sub)}
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
                  {sub.workStage}
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
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                  <th className="px-4 py-3">Tahapan Pekerjaan</th>
                  <th className="px-4 py-3">Kategori</th>
                  <th className="px-4 py-3">PIC Lapangan</th>
                  <th className="px-4 py-3">Tanggal &amp; Jam</th>
                  <th className="px-4 py-3">Koordinat GPS</th>
                  <th className="px-4 py-3">Status Validasi</th>
                  <th className="px-4 py-3 text-right">Drive</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSubmissions.map((sub) => (
                  <tr
                    key={sub.id}
                    onClick={() => setSelectedSubmission(sub)}
                    className="cursor-pointer hover:bg-slate-50/70"
                  >
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-900">{sub.workStage}</p>
                      <p className="text-xs text-slate-500">{sub.driveFolderName}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-700">{sub.category}</td>
                    <td className="px-4 py-3 text-xs font-medium text-slate-900">
                      {sub.picName}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                      {sub.capturedDate} {sub.capturedTime}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                      {sub.latitude.toFixed(5)}, {sub.longitude.toFixed(5)}
                    </td>
                    <td className="px-4 py-3">
                      <ValidationStatusLabel status={sub.validationStatus} />
                    </td>
                    <td
                      className="px-4 py-3 text-right"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <a
                        href={sub.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                      >
                        Buka
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {selectedSubmission && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">
                  Detail Dokumentasi · {selectedSubmission.location}
                </h3>
                <p className="text-xs text-slate-500">{selectedSubmission.workStage}</p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedSubmission(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-12">
              <div className="md:col-span-7">
                <DrivePhotoPreview
                  fileId={selectedSubmission.driveFileId}
                  fileName={selectedSubmission.driveFileName}
                  webViewLink={selectedSubmission.driveWebViewLink}
                  accessToken={accessToken}
                  onRequestReconnectDrive={onRequestReconnectDrive}
                />
              </div>
              <div className="md:col-span-5 space-y-3 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">Status</span>
                  <ValidationStatusLabel status={selectedSubmission.validationStatus} />
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Kategori</span>
                  <span className="font-semibold text-slate-900">
                    {selectedSubmission.category}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">PIC Lapangan</span>
                  <span className="font-medium text-slate-900">
                    {selectedSubmission.picName}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Tanggal Pelaksanaan</span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    {selectedSubmission.activityDate}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Waktu Pengambilan</span>
                  <span className="font-mono text-slate-900 tabular-nums">
                    {selectedSubmission.capturedDate} {selectedSubmission.capturedTime}
                  </span>
                </div>
                <div className="flex items-start justify-between gap-2">
                  <span className="text-slate-500">Koordinat GPS</span>
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
                      Buka di Google Maps
                    </a>
                  </div>
                </div>
                {selectedSubmission.notes && (
                  <div className="pt-2">
                    <span className="text-slate-500 block mb-1">Keterangan</span>
                    <p className="rounded-lg bg-slate-50 p-2.5 text-slate-800">
                      {selectedSubmission.notes}
                    </p>
                  </div>
                )}
                {selectedSubmission.validationNote && (
                  <div className="pt-1">
                    <span className="text-slate-500 block mb-1">Catatan Admin</span>
                    <p className="rounded-lg bg-slate-50 p-2.5 text-slate-800">
                      {selectedSubmission.validationNote}
                    </p>
                  </div>
                )}
                <div className="pt-3 border-t border-slate-100">
                  <a
                    href={selectedSubmission.driveWebViewLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] w-full items-center justify-center gap-2 rounded-lg bg-blue-700 px-4 text-xs font-semibold text-white hover:bg-blue-800"
                  >
                    Buka File di Google Drive
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
