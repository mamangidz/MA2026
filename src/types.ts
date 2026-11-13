export type UserRole = 'user' | 'admin' | 'viewer';
export type DevicePolicy = 'android_cellular' | 'windows_pc';
export type PhotoCategory = 'Peralatan' | 'Dokumen';
export type ValidationStatus = 'pending' | 'approved' | 'rejected';

export const DRIVE_ROOT_FOLDER_ID = '1R2Bhy6Ttxt5wrvf-yuOOQOXHyNT2jvAk';
export const DRIVE_ROOT_FOLDER_URL =
  'https://drive.google.com/drive/folders/1R2Bhy6Ttxt5wrvf-yuOOQOXHyNT2jvAk';

export const BOOTSTRAPPED_ADMIN_EMAIL = 'mamangidz@gmail.com';

export const DEFAULT_LOCATIONS = [
  'Jakarta',
  'Bandung',
  'Surabaya',
  'Jogyakarta',
  'Semarang',
  'Banten',
  'Ambon',
  'Pusat',
];

export const DEFAULT_WORK_STAGES = [
  'Survey Lapangan',
  'Pengiriman Material',
  'Instalasi Peralatan',
  'Uji Fungsi & Commissioning',
  'Serah Terima (BAST)',
  'Pemeliharaan Berkala',
];

export interface AppTaxonomy {
  locations: string[];
  workStages: string[];
  driveRootFolderId: string;
  updatedAt?: unknown;
  updatedByUid?: string;
}

export interface ManagedUser {
  id: string;
  rowNumber: number;
  location: string;
  picName: string;
  role: UserRole;
  username: string;
  password: string;
  authEmail: string;
  authUid: string;
  googleEmail: string;
  adminEmails: string[];
  devicePolicy: DevicePolicy;
  active: boolean;
  ownerUid: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface PhotoSubmission {
  id: string;
  location: string;
  workStage: string;
  activityDate: string; // YYYY-MM-DD
  category: PhotoCategory;
  notes: string;
  driveRootFolderId: string;
  driveFolderId: string;
  driveFolderName: string;
  driveFileId: string;
  driveFileName: string;
  driveWebViewLink: string;
  capturedTime: string; // HH:mm:ss
  capturedDate: string; // YYYY-MM-DD
  latitude: number;
  longitude: number;
  gpsAccuracy: number;
  devicePlatform: string;
  picName: string;
  picUsername: string;
  uploadedByUid: string;
  uploadedByEmail: string;
  viewerEmails: string[];
  adminEmails: string[];
  validationStatus: ValidationStatus;
  validationNote: string;
  validatedBy: string;
  validatedAt: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface ActivePicProfile {
  source: 'bootstrapped_admin' | 'managed_user';
  id: string;
  picName: string;
  username: string;
  role: UserRole;
  location: string;
  devicePolicy: DevicePolicy;
}

export interface GeoCoordinates {
  latitude: number;
  longitude: number;
  accuracy: number;
  timestamp: number;
}
