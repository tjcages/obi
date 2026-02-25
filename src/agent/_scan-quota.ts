export interface ScanConfig {
  enabled: boolean;
  maxScansPerDay: number;
  maxTokensPerDay: number;
  scanIntervalActiveMs: number;
  scanIntervalInactiveMs: number;
}

export interface ScanUsage {
  scansToday: number;
  tokensToday: number;
  lastScanAt: string | null;
  lastResetDate: string;
}

const STORAGE_KEY_SCAN_CONFIG = "scan:config";
const STORAGE_KEY_SCAN_USAGE = "scan:usage";

const DEFAULT_SCAN_CONFIG: ScanConfig = {
  enabled: true,
  maxScansPerDay: 48,
  maxTokensPerDay: 100_000,
  scanIntervalActiveMs: 15 * 60 * 1000,
  scanIntervalInactiveMs: 45 * 60 * 1000,
};

function todayDateStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function freshUsage(): ScanUsage {
  return {
    scansToday: 0,
    tokensToday: 0,
    lastScanAt: null,
    lastResetDate: todayDateStr(),
  };
}

export async function loadScanConfig(storage: DurableObjectStorage): Promise<ScanConfig> {
  const raw = await storage.get<Partial<ScanConfig>>(STORAGE_KEY_SCAN_CONFIG);
  if (!raw) return { ...DEFAULT_SCAN_CONFIG };
  return {
    enabled: typeof raw.enabled === "boolean" ? raw.enabled : DEFAULT_SCAN_CONFIG.enabled,
    maxScansPerDay: typeof raw.maxScansPerDay === "number" && raw.maxScansPerDay > 0
      ? raw.maxScansPerDay
      : DEFAULT_SCAN_CONFIG.maxScansPerDay,
    maxTokensPerDay: typeof raw.maxTokensPerDay === "number" && raw.maxTokensPerDay > 0
      ? raw.maxTokensPerDay
      : DEFAULT_SCAN_CONFIG.maxTokensPerDay,
    scanIntervalActiveMs: typeof raw.scanIntervalActiveMs === "number" && raw.scanIntervalActiveMs >= 60_000
      ? raw.scanIntervalActiveMs
      : DEFAULT_SCAN_CONFIG.scanIntervalActiveMs,
    scanIntervalInactiveMs: typeof raw.scanIntervalInactiveMs === "number" && raw.scanIntervalInactiveMs >= 60_000
      ? raw.scanIntervalInactiveMs
      : DEFAULT_SCAN_CONFIG.scanIntervalInactiveMs,
  };
}

export async function saveScanConfig(storage: DurableObjectStorage, config: ScanConfig): Promise<void> {
  await storage.put(STORAGE_KEY_SCAN_CONFIG, config);
}

export async function loadScanUsage(storage: DurableObjectStorage): Promise<ScanUsage> {
  const raw = await storage.get<ScanUsage>(STORAGE_KEY_SCAN_USAGE);
  if (!raw) return freshUsage();
  return resetIfNewDay(raw);
}

/**
 * Resets daily counters when the date rolls over.
 */
function resetIfNewDay(usage: ScanUsage): ScanUsage {
  const today = todayDateStr();
  if (usage.lastResetDate !== today) {
    return { ...usage, scansToday: 0, tokensToday: 0, lastResetDate: today };
  }
  return usage;
}

export async function recordScanUsage(
  storage: DurableObjectStorage,
  tokensUsed: number,
): Promise<ScanUsage> {
  const usage = await loadScanUsage(storage);
  const updated: ScanUsage = {
    scansToday: usage.scansToday + 1,
    tokensToday: usage.tokensToday + tokensUsed,
    lastScanAt: new Date().toISOString(),
    lastResetDate: usage.lastResetDate,
  };
  await storage.put(STORAGE_KEY_SCAN_USAGE, updated);
  return updated;
}

/**
 * Updates lastScanAt without incrementing the daily scan counter.
 * Use for scans that checked the inbox but found no new emails
 * needing LLM classification (i.e. zero-token scans).
 */
export async function touchLastScanAt(
  storage: DurableObjectStorage,
): Promise<ScanUsage> {
  const usage = await loadScanUsage(storage);
  const updated: ScanUsage = {
    ...usage,
    lastScanAt: new Date().toISOString(),
  };
  await storage.put(STORAGE_KEY_SCAN_USAGE, updated);
  return updated;
}

export interface CanScanResult {
  allowed: boolean;
  reason?: "disabled" | "scan_limit" | "token_limit";
}

export function canScan(config: ScanConfig, usage: ScanUsage): CanScanResult {
  if (!config.enabled) return { allowed: false, reason: "disabled" };
  if (usage.scansToday >= config.maxScansPerDay) return { allowed: false, reason: "scan_limit" };
  if (usage.tokensToday >= config.maxTokensPerDay) return { allowed: false, reason: "token_limit" };
  return { allowed: true };
}

export function getDefaultScanConfig(): ScanConfig {
  return { ...DEFAULT_SCAN_CONFIG };
}
