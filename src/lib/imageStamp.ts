export interface PhotoStampMetadata {
  location: string;
  workStage: string;
  category: string;
  capturedDate: string;
  capturedTime: string;
  latitude: number;
  longitude: number;
  gpsAccuracy: number;
  picName: string;
  applyStamp: boolean;
}

export async function processCapturedImage(
  fileOrBlob: Blob,
  meta: PhotoStampMetadata
): Promise<{ blob: Blob; previewUrl: string; width: number; height: number }> {
  const imageBitmap = await createImageBitmap(fileOrBlob);
  const maxDimension = 1920;

  let targetWidth = imageBitmap.width;
  let targetHeight = imageBitmap.height;

  if (targetWidth > maxDimension || targetHeight > maxDimension) {
    if (targetWidth >= targetHeight) {
      targetHeight = Math.round((targetHeight * maxDimension) / targetWidth);
      targetWidth = maxDimension;
    } else {
      targetWidth = Math.round((targetWidth * maxDimension) / targetHeight);
      targetHeight = maxDimension;
    }
  }

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Gagal menginisialisasi kanvas pemrosesan foto.');
  }

  ctx.drawImage(imageBitmap, 0, 0, targetWidth, targetHeight);
  imageBitmap.close();

  if (meta.applyStamp) {
    const pad = Math.max(16, Math.round(targetWidth * 0.02));
    const fontSize = Math.max(14, Math.round(targetWidth * 0.02));
    const lineHeight = Math.round(fontSize * 1.4);
    const barHeight = lineHeight * 3 + pad * 1.6;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.78)';
    ctx.fillRect(0, targetHeight - barHeight, targetWidth, barHeight);

    ctx.fillStyle = '#38BDF8';
    ctx.fillRect(0, targetHeight - barHeight, targetWidth, 3);

    ctx.font = `600 ${fontSize}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#F8FAFC';
    ctx.textBaseline = 'top';

    const topY = targetHeight - barHeight + pad * 0.7;
    const line1 = `${meta.location.toUpperCase()}  |  ${meta.workStage}  |  ${meta.category}`;
    const line2 = `TANGGAL: ${meta.capturedDate}   JAM: ${meta.capturedTime}   PIC: ${meta.picName}`;
    const line3 = `GPS: ${meta.latitude.toFixed(6)}, ${meta.longitude.toFixed(6)} (±${Math.round(meta.gpsAccuracy)}m)`;

    ctx.fillText(line1, pad, topY, targetWidth - pad * 2);
    ctx.font = `500 ${Math.round(fontSize * 0.92)}px "JetBrains Mono", monospace`;
    ctx.fillStyle = '#E2E8F0';
    ctx.fillText(line2, pad, topY + lineHeight, targetWidth - pad * 2);
    ctx.fillStyle = '#7DD3FC';
    ctx.fillText(line3, pad, topY + lineHeight * 2, targetWidth - pad * 2);
  }

  const outputBlob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) resolve(b);
        else reject(new Error('Gagal mengonversi foto ke JPEG.'));
      },
      'image/jpeg',
      0.88
    );
  });

  const previewUrl = URL.createObjectURL(outputBlob);
  return {
    blob: outputBlob,
    previewUrl,
    width: targetWidth,
    height: targetHeight,
  };
}
