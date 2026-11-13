import React, { useEffect, useState } from 'react';
import { ExternalLink, ImageOff, RefreshCw } from 'lucide-react';
import { fetchDriveImageBlobUrl } from '../lib/drive';

interface DrivePhotoPreviewProps {
  fileId: string;
  fileName: string;
  webViewLink: string;
  accessToken: string | null;
  onRequestReconnectDrive?: () => void;
  className?: string;
  aspectClass?: string;
}

export const DrivePhotoPreview: React.FC<DrivePhotoPreviewProps> = ({
  fileId,
  fileName,
  webViewLink,
  accessToken,
  onRequestReconnectDrive,
  className = '',
  aspectClass = 'aspect-4/3',
}) => {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    if (!accessToken || !fileId) {
      setImageUrl(null);
      return;
    }

    setLoading(true);
    setError(null);
    fetchDriveImageBlobUrl(accessToken, fileId)
      .then((url) => {
        if (active) {
          setImageUrl(url);
        }
      })
      .catch((err) => {
        if (active) {
          setError(err instanceof Error ? err.message : 'Gagal memuat pratinjau');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [accessToken, fileId]);

  if (loading) {
    return (
      <div
        className={`w-full ${aspectClass} animate-pulse rounded-lg bg-slate-200 flex items-center justify-center ${className}`}
      >
        <span className="text-xs font-medium text-slate-500">Memuat foto Drive...</span>
      </div>
    );
  }

  if (imageUrl && !error) {
    return (
      <div className={`w-full ${aspectClass} overflow-hidden rounded-lg bg-slate-900 ${className}`}>
        <img
          src={imageUrl}
          alt={fileName}
          referrerPolicy="no-referrer"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`w-full ${aspectClass} rounded-lg border border-slate-200 bg-slate-100 p-4 flex flex-col items-center justify-center text-center gap-2 ${className}`}
    >
      <ImageOff className="h-6 w-6 text-slate-400" />
      <p className="text-xs font-medium text-slate-700 line-clamp-2 max-w-[220px]">
        {fileName}
      </p>
      {!accessToken ? (
        <div className="flex flex-wrap items-center justify-center gap-2 mt-1">
          {onRequestReconnectDrive && (
            <button
              type="button"
              onClick={onRequestReconnectDrive}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-700 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-800 whitespace-nowrap"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Muat Foto Drive
            </button>
          )}
          <a
            href={webViewLink}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
          >
            Buka di Drive
            <ExternalLink className="h-3 w-3" />
          </a>
        </div>
      ) : (
        <a
          href={webViewLink}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:underline whitespace-nowrap"
        >
          Buka di Google Drive
          <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
};
