import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithCredential,
  signInWithPopup,
  User,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GoogleTokenClient {
  requestAccessToken: (overrideConfig?: { prompt?: string }) => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        oauth2?: {
          initTokenClient: (config: {
            client_id: string;
            scope: string;
            callback: (response: GoogleTokenResponse) => void;
            error_callback?: (error: { type: string; message?: string }) => void;
          }) => GoogleTokenClient;
        };
      };
    };
  }
}

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const provider = new GoogleAuthProvider();
provider.addScope(DRIVE_SCOPE);
provider.setCustomParameters({ prompt: 'select_account' });

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((p) => ({
          providerId: p.providerId,
          email: p.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

export const initAuth = (
  onAuthChange: (user: User | null, token: string | null) => void
) => {
  return onAuthStateChanged(auth, (user: User | null) => {
    if (user) {
      if (!isSigningIn && !cachedAccessToken) {
        onAuthChange(user, null);
      } else {
        onAuthChange(user, cachedAccessToken);
      }
    } else {
      cachedAccessToken = null;
      onAuthChange(null, null);
    }
  });
};

async function loadGisScriptIfNeeded(): Promise<void> {
  if (window.google?.accounts?.oauth2) return;
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="accounts.google.com/gsi/client"]'
    );
    if (existing) {
      let waited = 0;
      const timer = setInterval(() => {
        if (window.google?.accounts?.oauth2) {
          clearInterval(timer);
          resolve();
        } else if (waited > 5000) {
          clearInterval(timer);
          reject(new Error('Google Identity Services timeout'));
        }
        waited += 100;
      }, 100);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Gagal memuat Google Identity Services'));
    document.head.appendChild(script);
  });
}

async function signInWithGisFallback(): Promise<{
  user: User;
  accessToken: string;
}> {
  const clientId = firebaseConfig.oAuthClientId;
  if (!clientId) {
    throw new Error('auth/unauthorized-domain');
  }

  await loadGisScriptIfNeeded();
  const oauth2 = window.google?.accounts?.oauth2;
  if (!oauth2) {
    throw new Error('auth/unauthorized-domain');
  }

  const accessToken = await new Promise<string>((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: clientId,
      scope: `${DRIVE_SCOPE} openid email profile`,
      callback: (resp) => {
        if (resp.error || !resp.access_token) {
          reject(
            new Error(resp.error_description || resp.error || 'auth/unauthorized-domain')
          );
          return;
        }
        resolve(resp.access_token);
      },
      error_callback: (err) => {
        reject(new Error(err.message || err.type || 'auth/unauthorized-domain'));
      },
    });
    client.requestAccessToken({ prompt: 'select_account' });
  });

  const credential = GoogleAuthProvider.credential(null, accessToken);
  const result = await signInWithCredential(auth, credential);
  return { user: result.user, accessToken };
}

export const googleSignIn = async (): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  try {
    isSigningIn = true;
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (!credential?.accessToken) {
        throw new Error('Gagal memperoleh akses token Google Drive dari autentikasi.');
      }
      cachedAccessToken = credential.accessToken;
      return { user: result.user, accessToken: cachedAccessToken };
    } catch (popupErr: unknown) {
      const msg = popupErr instanceof Error ? popupErr.message : String(popupErr);
      const code =
        typeof popupErr === 'object' && popupErr !== null && 'code' in popupErr
          ? String((popupErr as { code: unknown }).code)
          : '';

      if (
        code === 'auth/unauthorized-domain' ||
        msg.includes('auth/unauthorized-domain')
      ) {
        // Fallback via Google Identity Services + signInWithCredential
        // which bypasses Firebase authDomain handler checks on shared URLs.
        try {
          const gisResult = await signInWithGisFallback();
          cachedAccessToken = gisResult.accessToken;
          return gisResult;
        } catch (gisErr) {
          const gisMsg = gisErr instanceof Error ? gisErr.message : String(gisErr);
          const err = new Error(`auth/unauthorized-domain (${gisMsg})`);
          throw err;
        }
      }
      throw popupErr;
    }
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  return cachedAccessToken;
};

export const logout = async () => {
  cachedAccessToken = null;
  await auth.signOut();
};

export const FIREBASE_PROJECT_ID = firebaseConfig.projectId;
