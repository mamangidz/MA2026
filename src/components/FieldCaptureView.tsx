import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileText,
  FolderOpen,
  Image as ImageIcon,
  LocateFixed,
  MapPin,
  RefreshCw,
  Smartphone,
  UploadCloud,
  Video,
  Wrench,
  X,
} from 'lucide-react';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import {
  ActivePicProfile,
  BOOTSTRAPPED_ADMIN_EMAIL,
  DRIVE_ROOT_FOLDER_ID,
  DRIVE_ROOT_FOLDER_URL,
  GeoCoordinates,
  ManagedUser,
  PhotoCategory,
  PhotoSubmission,
} from '../types';
import { checkDeviceCompliance, detectDeviceEnvironment } from '../lib/device';
import {
  findOrCreateSubfolder,
  formatDriveFolderName,
  formatDrivePhotoFileName,
  uploadPhotoToDrive,
} from '../lib/drive';
import { processCapturedImage } from '../lib/imageStamp';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { ValidationStatusLabel } from './ValidationBadge';
import { DrivePhotoPreview } from './DrivePhotoPreview';

interface FieldCaptureViewProps {
  picProfile: ActivePicProfile;
  userUid: string;
  userEmail: string;
  accessToken: string | null;
  locations: string[];
  workStages: string[];
  submissions: PhotoSubmission[];
  managedUsers: ManagedUser[];
  onRequestReconnectDrive: () => Promise<string | null>;
}

function formatLocalDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatLocalTime(date: Date): string {
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export const FieldCaptureView: React.FC<FieldCaptureViewProps> = ({
  picProfile,
  userUid,
  userEmail,
  accessToken,
  locations,
  workStages,
  submissions,
  managedUsers,
  onRequestReconnectDrive,
}) => {
  const deviceEnv = useMemo(() => detectDeviceEnvironment(), []);
  const compliance = useMemo(
    () => checkDeviceCompliance('user', deviceEnv),
    [deviceEnv]
  );

  const canChooseLocation =
    picProfile.role === 'admin' || picProfile.location === 'Pusat';

  const [selectedLocation, setSelectedLocation] = useState<string>(
    canChooseLocation ? locations[0] || 'Jakarta' : picProfile.location
  );
  const [workStage, setWorkStage] = useState<string>(
    workStages[0] || 'Survey Lapangan'
  );
  const [customWorkStage, setCustomWorkStage] = useState<string>('');
  const [useCustomStage, setUseCustomStage] = useState<boolean>(false);
  const [activityDate, setActivityDate] = useState<string>(() =>
    formatLocalDate(new Date())
  );
  const [category, setCategory] = useState<PhotoCategory>('Peralatan');
  const [notes, setNotes] = useState<string>('');
  const [applyStamp, setApplyStamp] = useState<boolean>(true);

  const [now, setNow] = useState<Date>(() => new Date());
  const [geo, setGeo] = useState<GeoCoordinates | null>(null);
  const [geoStatus, setGeoStatus] = useState<'locating' | 'ready' | 'error'>(
    'locating'
  );
  const [geoError, setGeoError] = useState<string>('');

  const [rawBlob, setRawBlob] = useState<Blob | null>(null);
  const [processedBlob, setProcessedBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedTime, setCapturedTime] = useState<string>('');
  const [capturedDate, setCapturedDate] = useState<string>('');

  const [cameraOpen, setCameraOpen] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string>('');
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nativeCameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  const [uploading, setUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string>('');
  const [uploadSuccess, setUploadSuccess] = useState<string>('');
  const [activeSubTab, setActiveSubTab] = useState<'capture' | 'history'>('capture');

  useEffect(() => {
    if (!canChooseLocation) {
      setSelectedLocation(picProfile.location);
    }
  }, [canChooseLocation, picProfile.location]);

  // Live clock every second
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Real GPS geolocation tracking
  const requestGps = () => {
    if (!('geolocation' in navigator)) {
      setGeoStatus('error');
      setGeoError('Perangkat ini tidak mendukung GPS Geolocation.');
      return;
    }
    setGeoStatus('locating');
    setGeoError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGeo({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
        setGeoStatus('ready');
      },
      (err) => {
        setGeoStatus('error');
        setGeoError(
          err.code === err.PERMISSION_DENIED
            ? 'Izin lokasi GPS ditolak. Aktifkan izin lokasi di browser HP Android Anda.'
            : 'Gagal memperoleh sinyal GPS. Pastikan GPS perangkat aktif dan coba lagi.'
        );
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 5000 }
    );
  };

  useEffect(() => {
    requestGps();
    if (!('geolocation' in navigator)) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setGeo({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          timestamp: pos.timestamp,
        });
        setGeoStatus('ready');
        setGeoError('');
      },
      () => {
        // Keep last valid fix or single-shot error
      },
      { enableHighAccuracy: true, maximumAge: 10000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const effectiveWorkStage = useCustomStage
    ? customWorkStage.trim() || 'Tahapan Khusus'
    : workStage;

  const previewFolderName = useMemo(
    () => formatDriveFolderName(selectedLocation, effectiveWorkStage, activityDate),
    [selectedLocation, effectiveWorkStage, activityDate]
  );

  const previewFileName = useMemo(
    () =>
      formatDrivePhotoFileName(
        selectedLocation,
        effectiveWorkStage,
        category,
        capturedDate || formatLocalDate(now),
        capturedTime || formatLocalTime(now)
      ),
    [selectedLocation, effectiveWorkStage, category, capturedDate, capturedTime, now]
  );

  // Re-render stamp preview when applyStamp or metadata changes on captured photo
  useEffect(() => {
    if (!rawBlob || !geo) return;
    let active = true;
    processCapturedImage(rawBlob, {
      location: selectedLocation,
      workStage: effectiveWorkStage,
      category,
      capturedDate: capturedDate || formatLocalDate(now),
      capturedTime: capturedTime || formatLocalTime(now),
      latitude: geo.latitude,
      longitude: geo.longitude,
      gpsAccuracy: geo.accuracy,
      picName: picProfile.picName,
      applyStamp,
    })
      .then((res) => {
        if (!active) {
          URL.revokeObjectURL(res.previewUrl);
          return;
        }
        setProcessedBlob(res.blob);
        setPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return res.previewUrl;
        });
      })
      .catch((err) => {
        console.error(err);
      });

    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rawBlob, applyStamp, selectedLocation, effectiveWorkStage, category]);

  const handleFileSelected = async (file: File | undefined) => {
    if (!file) return;
    setUploadError('');
    setUploadSuccess('');

    const captureNow = new Date();
    const cDate = formatLocalDate(captureNow);
    const cTime = formatLocalTime(captureNow);
    setCapturedDate(cDate);
    setCapturedTime(cTime);
    setRawBlob(file);

    if (geo) {
      const res = await processCapturedImage(file, {
        location: selectedLocation,
        workStage: effectiveWorkStage,
        category,
        capturedDate: cDate,
        capturedTime: cTime,
        latitude: geo.latitude,
        longitude: geo.longitude,
        gpsAccuracy: geo.accuracy,
        picName: picProfile.picName,
        applyStamp,
      });
      setProcessedBlob(res.blob);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return res.previewUrl;
      });
    } else {
      const tempUrl = URL.createObjectURL(file);
      setProcessedBlob(file);
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return tempUrl;
      });
    }
  };

  const openWebCamera = async () => {
    setCameraError('');
    setCameraOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
    } catch {
      setCameraError(
        'Kamera browser tidak dapat diakses. Gunakan tombol Kamera HP Android atau pilih file.'
      );
      setCameraOpen(false);
    }
  };

  const closeWebCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setCameraOpen(false);
  };

  const takeWebCameraSnapshot = () => {
    const video = videoRef.current;
    if (!video) return;
    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth || 1280;
    canvas.height = video.videoHeight || 720;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (blob) {
          const file = new File([blob], 'camera-capture.jpg', { type: 'image/jpeg' });
          handleFileSelected(file);
          closeWebCamera();
        }
      },
      'image/jpeg',
      0.92
    );
  };

  const clearCapturedPhoto = () => {
    setRawBlob(null);
    setProcessedBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    setCapturedDate('');
    setCapturedTime('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError('');
    setUploadSuccess('');

    if (!processedBlob) {
      setUploadError('Ambil atau pilih foto terlebih dahulu.');
      return;
    }
    if (!geo) {
      setUploadError(
        'Koordinat GPS belum tersedia. Aktifkan GPS perangkat dan tekan segarkan lokasi.'
      );
      return;
    }

    let token = accessToken;
    if (!token) {
      token = await onRequestReconnectDrive();
      if (!token) {
        setUploadError('Otorisasi Google Drive diperlukan untuk mengunggah foto.');
        return;
      }
    }

    setUploading(true);
    try {
      const cDate = capturedDate || formatLocalDate(new Date());
      const cTime = capturedTime || formatLocalTime(new Date());
      const folderName = formatDriveFolderName(
        selectedLocation,
        effectiveWorkStage,
        activityDate
      );
      const fileName = formatDrivePhotoFileName(
        selectedLocation,
        effectiveWorkStage,
        category,
        cDate,
        cTime
      );

      const folder = await findOrCreateSubfolder(
        token,
        folderName,
        DRIVE_ROOT_FOLDER_ID
      );

      const driveDesc = [
        `Lokasi: ${selectedLocation}`,
        `Tahapan: ${effectiveWorkStage}`,
        `Kategori: ${category}`,
        `Tanggal Pelaksanaan: ${activityDate}`,
        `Waktu Pengambilan: ${cDate} ${cTime}`,
        `GPS: ${geo.latitude.toFixed(6)}, ${geo.longitude.toFixed(6)} (±${Math.round(geo.accuracy)}m)`,
        `PIC: ${picProfile.picName} (${picProfile.username})`,
        `Perangkat: ${deviceEnv.label}`,
        notes ? `Keterangan: ${notes}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      const uploaded = await uploadPhotoToDrive(
        token,
        folder.id,
        fileName,
        processedBlob,
        driveDesc
      );

      const viewerEmails = Array.from(
        new Set(
          managedUsers
            .filter(
              (u) =>
                u.active &&
                u.role === 'viewer' &&
                u.location.toLowerCase() === selectedLocation.toLowerCase() &&
                u.googleEmail
            )
            .map((u) => u.googleEmail.trim().toLowerCase())
        )
      ).slice(0, 10);

      const adminEmails = Array.from(
        new Set([
          BOOTSTRAPPED_ADMIN_EMAIL,
          ...managedUsers
            .filter((u) => u.active && u.role === 'admin' && u.googleEmail)
            .map((u) => u.googleEmail.trim().toLowerCase()),
        ])
      ).slice(0, 10);

      const submissionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const payload = {
        id: submissionId,
        location: selectedLocation,
        workStage: effectiveWorkStage,
        activityDate,
        category,
        notes: notes.trim().slice(0, 500),
        driveRootFolderId: DRIVE_ROOT_FOLDER_ID,
        driveFolderId: folder.id,
        driveFolderName: folder.name,
        driveFileId: uploaded.id,
        driveFileName: uploaded.name,
        driveWebViewLink: uploaded.webViewLink,
        capturedTime: cTime,
        capturedDate: cDate,
        latitude: Number(geo.latitude.toFixed(6)),
        longitude: Number(geo.longitude.toFixed(6)),
        gpsAccuracy: Math.round(geo.accuracy),
        devicePlatform: deviceEnv.label,
        picName: picProfile.picName,
        picUsername: picProfile.username,
        uploadedByUid: userUid,
        uploadedByEmail: userEmail,
        viewerEmails,
        adminEmails,
        validationStatus: 'pending',
        validationNote: '',
        validatedBy: '',
        validatedAt: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      try {
        await setDoc(doc(db, 'photo_submissions', submissionId), payload);
      } catch (fsErr) {
        handleFirestoreError(
          fsErr,
          OperationType.CREATE,
          `photo_submissions/${submissionId}`
        );
      }

      setUploadSuccess(
        `Foto berhasil disimpan ke Google Drive (${folder.name}/${uploaded.name}) dan menunggu validasi Admin.`
      );
      setNotes('');
      clearCapturedPhoto();
    } catch (err) {
      setUploadError(
        err instanceof Error ? err.message : 'Terjadi kesalahan saat mengunggah foto.'
      );
    } finally {
      setUploading(false);
    }
  };

  const mySubmissions = useMemo(
    () =>
      submissions.filter(
        (s) =>
          s.uploadedByUid === userUid ||
          s.picUsername.toLowerCase() === picProfile.username.toLowerCase()
      ),
    [submissions, userUid, picProfile.username]
  );

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 pb-24 md:px-6 md:py-8">
      {/* Policy & Device Status Bar */}
      <div className="mb-5 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
              compliance.compliant
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-amber-50 text-amber-700'
            }`}
          >
            <Smartphone className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-900">
              <span>Input Lapangan · {picProfile.picName}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span className="text-blue-700">{selectedLocation}</span>
            </div>
            <p className="mt-0.5 text-xs text-slate-600">{compliance.message}</p>
          </div>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1 self-start sm:self-center">
          <button
            type="button"
            onClick={() => setActiveSubTab('capture')}
            className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'capture'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Ambil &amp; Kirim Foto
          </button>
          <button
            type="button"
            onClick={() => setActiveSubTab('history')}
            className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-medium transition-colors whitespace-nowrap ${
              activeSubTab === 'history'
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Riwayat ({mySubmissions.length})
          </button>
        </div>
      </div>

      {activeSubTab === 'capture' ? (
        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start"
        >
          {/* Left Column: Telemetry & Camera Capture */}
          <div className="space-y-5 lg:col-span-6">
            {/* Live GPS & Time Telemetry Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Telemetri GPS &amp; Waktu Perangkat
                </h2>
                <button
                  type="button"
                  onClick={requestGps}
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Segarkan GPS
                </button>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-100 pt-3">
                <div>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <Clock className="h-3.5 w-3.5" />
                    Tanggal &amp; Jam
                  </span>
                  <p className="mt-1 font-mono text-sm font-medium text-slate-900 tabular-nums">
                    {formatLocalDate(now)} · {formatLocalTime(now)}
                  </p>
                </div>
                <div>
                  <span className="text-xs text-slate-500 flex items-center gap-1">
                    <LocateFixed className="h-3.5 w-3.5" />
                    Koordinat GPS
                  </span>
                  {geoStatus === 'ready' && geo ? (
                    <p className="mt-1 font-mono text-xs font-medium text-emerald-700 tabular-nums">
                      {geo.latitude.toFixed(6)}, {geo.longitude.toFixed(6)} (±
                      {Math.round(geo.accuracy)}m)
                    </p>
                  ) : geoStatus === 'locating' ? (
                    <p className="mt-1 text-xs font-medium text-amber-700">
                      Mencari sinyal GPS...
                    </p>
                  ) : (
                    <p className="mt-1 text-xs font-medium text-red-700">
                      GPS belum aktif
                    </p>
                  )}
                </div>
              </div>

              {geoError && (
                <div className="mt-3 rounded-lg bg-red-50 p-3 text-xs text-red-800">
                  {geoError}
                </div>
              )}
            </div>

            {/* Camera & Photo Capture Card */}
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-900">
                  Foto Peralatan / Dokumen
                </h2>
                {previewUrl && (
                  <button
                    type="button"
                    onClick={clearCapturedPhoto}
                    className="inline-flex items-center gap-1 text-xs font-medium text-red-700 hover:underline whitespace-nowrap"
                  >
                    <X className="h-3.5 w-3.5" />
                    Ganti Foto
                  </button>
                )}
              </div>

              {cameraOpen ? (
                <div className="mt-4 overflow-hidden rounded-xl bg-slate-900">
                  <video
                    ref={videoRef}
                    autoPlay
                    playsInline
                    muted
                    className="aspect-4/3 w-full object-cover"
                  />
                  <div className="flex items-center justify-between gap-3 p-3 bg-slate-950">
                    <button
                      type="button"
                      onClick={closeWebCamera}
                      className="min-h-[44px] rounded-lg border border-slate-700 px-4 py-2 text-xs font-medium text-slate-200 hover:bg-slate-800"
                    >
                      Tutup Kamera
                    </button>
                    <button
                      type="button"
                      onClick={takeWebCameraSnapshot}
                      className="min-h-[44px] flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Jepret Foto Sekarang
                    </button>
                  </div>
                </div>
              ) : previewUrl ? (
                <div className="mt-4 space-y-3">
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                    <img
                      src={previewUrl}
                      alt="Pratinjau foto lapangan"
                      className="max-h-[420px] w-full object-contain mx-auto"
                    />
                  </div>
                  <div className="flex items-center justify-between text-xs text-slate-600">
                    <span>
                      Diambil: <strong className="font-mono">{capturedDate} {capturedTime}</strong>
                    </span>
                    <label className="inline-flex items-center gap-2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={applyStamp}
                        onChange={(e) => setApplyStamp(e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-blue-700"
                      />
                      <span>Stempel Jam &amp; GPS di Foto</span>
                    </label>
                  </div>
                </div>
              ) : (
                <div className="mt-4 space-y-3">
                  <input
                    ref={nativeCameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    onChange={(e) => handleFileSelected(e.target.files?.[0])}
                    className="hidden"
                  />
                  <input
                    ref={galleryInputRef}
                    type="file"
                    accept="image/*"
                    onChange={(e) => handleFileSelected(e.target.files?.[0])}
                    className="hidden"
                  />

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <button
                      type="button"
                      onClick={() => nativeCameraInputRef.current?.click()}
                      className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/60 p-4 text-blue-900 transition-colors hover:bg-blue-50 active:scale-[0.99]"
                    >
                      <Camera className="h-6 w-6 text-blue-700" />
                      <span className="text-sm font-semibold">Kamera HP (Android)</span>
                      <span className="text-xs text-blue-700">
                        Buka kamera belakang langsung
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={openWebCamera}
                      className="flex min-h-[96px] flex-col items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 p-4 text-slate-800 transition-colors hover:bg-slate-100 active:scale-[0.99]"
                    >
                      <Video className="h-6 w-6 text-slate-700" />
                      <span className="text-sm font-semibold">Kamera Web Langsung</span>
                      <span className="text-xs text-slate-500">
                        Pratinjau kamera di browser
                      </span>
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => galleryInputRef.current?.click()}
                    className="flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ImageIcon className="h-4 w-4 text-slate-500" />
                    Pilih Foto dari Galeri / File
                  </button>

                  {cameraError && (
                    <p className="text-xs text-amber-700">{cameraError}</p>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Metadata Form & Drive Naming Preview */}
          <div className="space-y-5 lg:col-span-6">
            <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5 space-y-4">
              <h2 className="text-sm font-semibold text-slate-900">
                Detail Kegiatan &amp; Penamaan Google Drive
              </h2>

              {/* Category Toggle */}
              <div>
                <label className="block text-xs font-medium text-slate-700 mb-1.5">
                  Jenis Foto
                </label>
                <div className="grid grid-cols-2 gap-2 rounded-lg bg-slate-100 p-1">
                  <button
                    type="button"
                    onClick={() => setCategory('Peralatan')}
                    className={`flex min-h-[44px] items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ${
                      category === 'Peralatan'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <Wrench className="h-4 w-4" />
                    Peralatan Lapangan
                  </button>
                  <button
                    type="button"
                    onClick={() => setCategory('Dokumen')}
                    className={`flex min-h-[44px] items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors ${
                      category === 'Dokumen'
                        ? 'bg-white text-slate-900 shadow-xs'
                        : 'text-slate-600 hover:text-slate-900'
                    }`}
                  >
                    <FileText className="h-4 w-4" />
                    Dokumen
                  </button>
                </div>
              </div>

              {/* Location & Date */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="field-location"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Lokasi
                  </label>
                  <select
                    id="field-location"
                    value={selectedLocation}
                    disabled={!canChooseLocation}
                    onChange={(e) => setSelectedLocation(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 disabled:bg-slate-100 disabled:text-slate-600"
                  >
                    {Array.from(new Set([...locations, selectedLocation])).map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="field-activity-date"
                    className="block text-xs font-medium text-slate-700 mb-1.5"
                  >
                    Tanggal Pelaksanaan
                  </label>
                  <input
                    id="field-activity-date"
                    type="date"
                    value={activityDate}
                    onChange={(e) => setActivityDate(e.target.value)}
                    required
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm font-mono text-slate-900"
                  />
                </div>
              </div>

              {/* Work Stage */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label
                    htmlFor="field-work-stage"
                    className="block text-xs font-medium text-slate-700"
                  >
                    Tahapan Pekerjaan
                  </label>
                  <button
                    type="button"
                    onClick={() => setUseCustomStage(!useCustomStage)}
                    className="text-xs font-medium text-blue-700 hover:underline"
                  >
                    {useCustomStage ? 'Pilih dari daftar' : 'Ketik tahapan lain'}
                  </button>
                </div>
                {useCustomStage ? (
                  <input
                    id="field-work-stage"
                    type="text"
                    value={customWorkStage}
                    onChange={(e) => setCustomWorkStage(e.target.value)}
                    placeholder="Masukkan nama tahapan pekerjaan..."
                    required
                    maxLength={120}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  />
                ) : (
                  <select
                    id="field-work-stage"
                    value={workStage}
                    onChange={(e) => setWorkStage(e.target.value)}
                    className="min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900"
                  >
                    {workStages.map((stage) => (
                      <option key={stage} value={stage}>
                        {stage}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Notes */}
              <div>
                <label
                  htmlFor="field-notes"
                  className="block text-xs font-medium text-slate-700 mb-1.5"
                >
                  Keterangan Peralatan / Dokumen (Opsional)
                </label>
                <textarea
                  id="field-notes"
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Rack Server Unit A / Berita Acara Uji Terima..."
                  className="w-full rounded-lg border border-slate-300 bg-white p-3 text-sm text-slate-900"
                />
              </div>

              {/* Live Drive Path Preview */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
                    <FolderOpen className="h-3.5 w-3.5 text-blue-700" />
                    Struktur Penyimpanan Google Drive
                  </span>
                  <a
                    href={DRIVE_ROOT_FOLDER_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline"
                  >
                    Buka Folder Induk
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>
                <div className="space-y-1 text-xs">
                  <div className="flex flex-col">
                    <span className="text-slate-500">Nama Folder (Lokasi - Tahapan - Tanggal):</span>
                    <span className="font-mono font-medium text-slate-900 break-all">
                      {previewFolderName}
                    </span>
                  </div>
                  <div className="flex flex-col pt-1">
                    <span className="text-slate-500">Nama File Foto (Lokasi &amp; Tahapan):</span>
                    <span className="font-mono font-medium text-slate-900 break-all">
                      {previewFileName}
                    </span>
                  </div>
                </div>
              </div>

              {uploadError && (
                <div className="rounded-lg bg-red-50 p-3 text-xs font-medium text-red-800">
                  {uploadError}
                </div>
              )}

              {uploadSuccess && (
                <div className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-800">
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{uploadSuccess}</span>
                </div>
              )}

              {/* Desktop Submit Button */}
              <div className="hidden md:block pt-1">
                <button
                  type="submit"
                  disabled={uploading || !processedBlob || !geo}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-800 disabled:cursor-not-allowed disabled:bg-slate-300"
                >
                  <UploadCloud className="h-4 w-4" />
                  {uploading
                    ? 'Mengunggah ke Google Drive...'
                    : 'Kirim Foto ke Google Drive'}
                </button>
              </div>
            </div>
          </div>

          {/* Mobile Sticky Bottom CTA Bar (<= 15% height) */}
          <div className="fixed bottom-0 left-0 right-0 z-30 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur-md md:hidden">
            <button
              type="submit"
              disabled={uploading || !processedBlob || !geo}
              className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 text-sm font-semibold text-white shadow-sm active:scale-[0.99] disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <UploadCloud className="h-4 w-4" />
              {uploading
                ? 'Mengunggah ke Drive...'
                : !processedBlob
                  ? 'Ambil Foto Dahulu'
                  : !geo
                    ? 'Menunggu Sinyal GPS...'
                    : 'Kirim Foto ke Google Drive'}
            </button>
          </div>
        </form>
      ) : (
        /* History Tab */
        <div className="space-y-4">
          {mySubmissions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
              <p className="text-sm font-medium text-slate-900">
                Belum ada foto yang dikirimkan
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Foto peralatan dan dokumen yang Anda kirim akan muncul di sini beserta status validasi admin.
              </p>
              <button
                type="button"
                onClick={() => setActiveSubTab('capture')}
                className="mt-4 inline-flex min-h-[40px] items-center gap-2 rounded-lg bg-blue-700 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-800"
              >
                <Camera className="h-4 w-4" />
                Ambil Foto Pertama
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {mySubmissions.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
                >
                  <DrivePhotoPreview
                    fileId={item.driveFileId}
                    fileName={item.driveFileName}
                    webViewLink={item.driveWebViewLink}
                    accessToken={accessToken}
                    onRequestReconnectDrive={onRequestReconnectDrive}
                  />
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <ValidationStatusLabel status={item.validationStatus} />
                      <span className="text-xs font-medium text-slate-500">
                        {item.category}
                      </span>
                    </div>
                    <h3 className="mt-1.5 text-sm font-semibold text-slate-900 line-clamp-1">
                      {item.workStage}
                    </h3>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      <span>{item.location}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {item.capturedDate} {item.capturedTime}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 text-xs font-mono text-slate-600 tabular-nums">
                      <MapPin className="h-3 w-3 text-slate-400 shrink-0" />
                      <span>
                        {item.latitude.toFixed(5)}, {item.longitude.toFixed(5)}
                      </span>
                    </div>
                    {item.validationNote && (
                      <p className="mt-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-700">
                        Catatan Admin: {item.validationNote}
                      </p>
                    )}
                    <div className="mt-2 pt-2 border-t border-slate-100 flex items-center justify-between text-xs">
                      <span className="truncate text-slate-500 max-w-[180px]">
                        {item.driveFolderName}
                      </span>
                      <a
                        href={item.driveWebViewLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 font-medium text-blue-700 hover:underline shrink-0"
                      >
                        Drive
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
