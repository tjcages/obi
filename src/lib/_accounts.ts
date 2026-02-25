export interface ConnectedAccount {
  email: string;
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  label?: string;
  color?: string;
  photoUrl?: string;
  name?: string;
  isPrimary?: boolean;
  connectedAt: number;
}

export interface ConnectedAccountPublic {
  email: string;
  label?: string;
  color?: string;
  photoUrl?: string;
  name?: string;
  isPrimary?: boolean;
  connectedAt: number;
}

export const STORAGE_KEY_ACCOUNTS = "gmail_accounts";
export const STORAGE_KEY_ACTIVE_EMAILS = "active_account_emails";

const DEFAULT_COLORS = [
  "#6d86d3", "#7c3aed", "#059669", "#d97706",
  "#e11d48", "#0891b2", "#db2777", "#4f46e5",
];

export function pickDefaultColor(index: number): string {
  return DEFAULT_COLORS[index % DEFAULT_COLORS.length];
}

export function toPublicAccount(account: ConnectedAccount): ConnectedAccountPublic {
  return {
    email: account.email,
    label: account.label,
    color: account.color,
    photoUrl: account.photoUrl,
    name: account.name,
    isPrimary: account.isPrimary,
    connectedAt: account.connectedAt,
  };
}

interface OldGmailSession {
  access_token: string;
  refresh_token: string;
  client_id: string;
  client_secret: string;
  email: string;
}

export function migrateFromSingleSession(session: OldGmailSession): ConnectedAccount {
  return {
    email: session.email,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    client_id: session.client_id,
    client_secret: session.client_secret,
    color: DEFAULT_COLORS[0],
    isPrimary: true,
    connectedAt: Date.now(),
  };
}

interface GoogleProfile {
  photoUrl?: string;
  name?: string;
}

export async function fetchGoogleProfile(accessToken: string): Promise<GoogleProfile> {
  try {
    const res = await fetch(
      "https://people.googleapis.com/v1/people/me?personFields=photos,names",
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) return {};
    const data = (await res.json()) as {
      photos?: { url?: string; metadata?: { primary?: boolean } }[];
      names?: { displayName?: string; metadata?: { primary?: boolean } }[];
    };
    const photo = data.photos?.find((p) => p.metadata?.primary) ?? data.photos?.[0];
    const nameEntry = data.names?.find((n) => n.metadata?.primary) ?? data.names?.[0];
    return {
      photoUrl: photo?.url,
      name: nameEntry?.displayName,
    };
  } catch {
    return {};
  }
}
