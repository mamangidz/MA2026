import React from 'react';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { ValidationStatus } from '../types';

interface ValidationStatusLabelProps {
  status: ValidationStatus;
}

export const ValidationStatusLabel: React.FC<ValidationStatusLabelProps> = ({
  status,
}) => {
  if (status === 'approved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 whitespace-nowrap shrink-0">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        Disetujui
      </span>
    );
  }
  if (status === 'rejected') {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-700 whitespace-nowrap shrink-0">
        <XCircle className="h-3.5 w-3.5 shrink-0" />
        Ditolak
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-700 whitespace-nowrap shrink-0">
      <Clock className="h-3.5 w-3.5 shrink-0" />
      Menunggu Validasi
    </span>
  );
};
