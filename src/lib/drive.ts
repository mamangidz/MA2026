import { DRIVE_ROOT_FOLDER_ID, PhotoCategory } from '../types';

function sanitizeNamePart(input: string): string {
  return input
    .trim()
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ');
}

export function formatDriveFolderName(
  location: string,
  workStage: string,
  activityDate: string
): string {
  const loc = sanitizeNamePart(location) || 'Lokasi';
  const stage = sanitizeNamePart(workStage) || 'Tahapan';
  const date = sanitizeNamePart(activityDate) || new Date().toISOString().slice(0, 10);
  return `${loc} - ${stage} - ${date}`;
}

export function formatDrivePhotoFileName(
  location: string,
  workStage: string,
  category: PhotoCategory,
  capturedDate: string,
  capturedTime: string
): string {
  const loc = sanitizeNamePart(location).replace(/\s+/g, '_') || 'Lokasi';
  const stage = sanitizeNamePart(workStage).replace(/\s+/g, '_') || 'Tahapan';
  const compactDate = capturedDate.replace(/-/g, '');
  const compactTime = capturedTime.replace(/:/g, '');
  return `${loc}_${stage}_${category}_${compactDate}_${compactTime}.jpg`;
}

function escapeDriveQueryValue(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

export async function findOrCreateSubfolder(
  accessToken: string,
  folderName: string,
  parentFolderId: string = DRIVE_ROOT_FOLDER_ID
): Promise<{ id: string; name: string }> {
  const q = [
    "mimeType = 'application/vnd.google-apps.folder'",
    `name = '${escapeDriveQueryValue(folderName)}'`,
    `'${escapeDriveQueryValue(parentFolderId)}' in parents`,
    'trashed = false',
  ].join(' and ');

  const searchParams = new URLSearchParams({
    q,
    fields: 'files(id, name)',
    supportsAllDrives: 'true',
    includeItemsFromAllDrives: 'true',
    pageSize: '1',
  });

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?${searchParams.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!searchRes.ok) {
    const errText = await searchRes.text();
    throw new Error(`Gagal memeriksa folder Google Drive (${searchRes.status}): ${errText}`);
  }

  const searchData = (await searchRes.json()) as {
    files?: { id: string; name: string }[];
  };

  if (searchData.files && searchData.files.length > 0) {
    return searchData.files[0];
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&fields=id,name',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentFolderId],
      }),
    }
  );

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Gagal membuat folder di Google Drive (${createRes.status}): ${errText}`);
  }

  return (await createRes.json()) as { id: string; name: string };
}

export async function uploadPhotoToDrive(
  accessToken: string,
  folderId: string,
  fileName: string,
  photoBlob: Blob,
  description: string
): Promise<{
  id: string;
  name: string;
  webViewLink: string;
}> {
  const boundary = `fieldSnapBoundary_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const metadata = {
    name: fileName,
    parents: [folderId],
    description,
    mimeType: 'image/jpeg',
  };

  const metadataPart =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: image/jpeg\r\n\r\n`;

  const closingBoundary = `\r\n--${boundary}--`;

  const multipartBody = new Blob([metadataPart, photoBlob, closingBoundary], {
    type: `multipart/related; boundary=${boundary}`,
  });

  const res = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
      body: multipartBody,
    }
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gagal mengunggah foto ke Google Drive (${res.status}): ${errText}`);
  }

  const data = (await res.json()) as {
    id: string;
    name: string;
    webViewLink?: string;
  };

  return {
    id: data.id,
    name: data.name,
    webViewLink: data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`,
  };
}

const imageObjectUrlCache = new Map<string, string>();

export async function fetchDriveImageBlobUrl(
  accessToken: string,
  fileId: string
): Promise<string> {
  const cached = imageObjectUrlCache.get(fileId);
  if (cached) return cached;

  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok) {
    throw new Error(`Tidak dapat memuat pratinjau foto Drive (${res.status})`);
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  imageObjectUrlCache.set(fileId, url);
  return url;
}

export async function deleteDriveFile(
  accessToken: string,
  fileId: string
): Promise<void> {
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?supportsAllDrives=true`,
    {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!res.ok && res.status !== 404) {
    const errText = await res.text();
    throw new Error(`Gagal menghapus file dari Google Drive (${res.status}): ${errText}`);
  }

  const cached = imageObjectUrlCache.get(fileId);
  if (cached) {
    URL.revokeObjectURL(cached);
    imageObjectUrlCache.delete(fileId);
  }
}
