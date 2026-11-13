import { DevicePolicy, ManagedUser, UserRole } from '../types';

export interface ParsedCsvUserRow {
  rowNumber: number;
  location: string;
  picName: string;
  role: UserRole;
  username: string;
  password: string;
  googleEmail: string;
  devicePolicy: DevicePolicy;
}

function normalizeRole(raw: string): UserRole | null {
  const clean = raw.trim().toLowerCase();
  if (clean === 'user' || clean === 'admin' || clean === 'viewer') {
    return clean;
  }
  return null;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

export function parseUsersCsv(csvText: string): {
  rows: ParsedCsvUserRow[];
  skippedLines: number;
} {
  const lines = csvText
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return { rows: [], skippedLines: 0 };
  }

  // Detect delimiter (, or ;)
  const sample = lines[0];
  const delimiter = sample.includes(';') && !sample.includes(',') ? ';' : ',';

  const rows: ParsedCsvUserRow[] = [];
  let skippedLines = 0;

  for (const line of lines) {
    const cols = splitCsvLine(line, delimiter);
    // Skip empty separator rows like ",,,,,"
    if (cols.every((c) => c === '')) {
      continue;
    }

    // Check if this is a header row (e.g. "No,Nama Lokasi,PIC...,Otorisasi,username,password")
    const joinedLower = cols.join(' ').toLowerCase();
    if (
      joinedLower.includes('nama lokasi') ||
      joinedLower.includes('otorisasi') ||
      (joinedLower.includes('username') && joinedLower.includes('password'))
    ) {
      continue;
    }

    // Expected column layout:
    // 0: No, 1: Nama Lokasi, 2: PIC, 3: Otorisasi, 4: username, 5: password, (optional 6: googleEmail)
    if (cols.length < 6) {
      skippedLines++;
      continue;
    }

    const rowNum = parseInt(cols[0], 10);
    const location = cols[1]?.trim() || '';
    const picName = cols[2]?.trim() || '';
    const role = normalizeRole(cols[3] || '');
    const username = cols[4]?.trim() || '';
    const password = cols[5]?.trim() || '';
    const googleEmail = (cols[6] || '').trim().toLowerCase();

    if (!location || !picName || !role || !username || !password) {
      skippedLines++;
      continue;
    }

    rows.push({
      rowNumber: Number.isFinite(rowNum) && rowNum > 0 ? rowNum : rows.length + 1,
      location,
      picName,
      role,
      username,
      password,
      googleEmail,
      devicePolicy: role === 'user' ? 'android_cellular' : 'windows_pc',
    });
  }

  return { rows, skippedLines };
}

export function exportUsersToCsv(users: ManagedUser[]): string {
  const header = 'No,Nama Lokasi,PIC,Otorisasi,username,password,Email Google,Perangkat';
  const lines = users.map((u, idx) => {
    const escape = (val: string) => {
      if (val.includes(',') || val.includes('"') || val.includes('\n')) {
        return `"${val.replace(/"/g, '""')}"`;
      }
      return val;
    };
    return [
      idx + 1,
      escape(u.location),
      escape(u.picName),
      escape(u.role),
      escape(u.username),
      escape(u.password),
      escape(u.googleEmail || ''),
      escape(u.devicePolicy === 'android_cellular' ? 'HP Android' : 'PC Windows'),
    ].join(',');
  });
  return [header, ...lines].join('\n');
}

export function downloadCsvFile(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
