import { DevicePolicy, UserRole } from '../types';

export interface DeviceEnvironment {
  isAndroid: boolean;
  isWindows: boolean;
  isMobile: boolean;
  label: string;
}

export function detectDeviceEnvironment(): DeviceEnvironment {
  if (typeof navigator === 'undefined') {
    return {
      isAndroid: false,
      isWindows: false,
      isMobile: false,
      label: 'Web Browser',
    };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /android/i.test(ua);
  const isWindows = /windows/i.test(ua);
  const isMobile = /android|iphone|ipad|ipod|mobile/i.test(ua);

  let label = 'Desktop Browser';
  if (isAndroid) {
    label = 'Android Cellular';
  } else if (isWindows) {
    label = 'Windows PC';
  } else if (isMobile) {
    label = 'Mobile Cellular';
  }

  return {
    isAndroid,
    isWindows,
    isMobile,
    label,
  };
}

export function getExpectedDevicePolicy(role: UserRole): DevicePolicy {
  return role === 'user' ? 'android_cellular' : 'windows_pc';
}

export function formatDevicePolicyLabel(policy: DevicePolicy): string {
  return policy === 'android_cellular' ? 'HP Cellular Android' : 'PC Windows Based';
}

export function checkDeviceCompliance(role: UserRole, env: DeviceEnvironment): {
  compliant: boolean;
  expectedLabel: string;
  message: string;
} {
  if (role === 'user') {
    if (env.isAndroid) {
      return {
        compliant: true,
        expectedLabel: 'HP Cellular Android',
        message: 'Perangkat Android terverifikasi untuk input lapangan.',
      };
    }
    return {
      compliant: false,
      expectedLabel: 'HP Cellular Android',
      message: `Perangkat terdeteksi (${env.label}). Kebijakan role User mewajibkan HP/Cellular Android.`,
    };
  }

  if (env.isWindows) {
    return {
      compliant: true,
      expectedLabel: 'PC Windows Based',
      message: 'Perangkat PC Windows terverifikasi.',
    };
  }

  return {
    compliant: false,
    expectedLabel: 'PC Windows Based',
    message: `Perangkat terdeteksi (${env.label}). Kebijakan role ${role === 'admin' ? 'Admin' : 'Viewer'} merekomendasikan PC Windows.`,
  };
}
