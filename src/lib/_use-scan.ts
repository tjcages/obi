import { useCallback, useEffect, useRef, useState } from "react";

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

export interface ScanResult {
  suggested: number;
  tokensUsed: number;
  emailsScanned: number;
  skippedDuplicate: number;
  skipped?: string;
}

interface UseScanReturn {
  config: ScanConfig | null;
  usage: ScanUsage | null;
  nextAlarmAt: string | null;
  loading: boolean;
  refresh: () => Promise<void>;
  updateConfig: (updates: Partial<ScanConfig>) => Promise<void>;
  triggerScan: () => Promise<void>;
  triggering: boolean;
  scanning: boolean;
  lastScanResult: ScanResult | null;
}

const DEBOUNCE_MS = 60_000;
const FOREGROUND_INTERVAL_MS = 10 * 60 * 1000;
const SCAN_TIMEOUT_MS = 60_000;

interface UseScanOptions {
  onScanComplete?: (result: ScanResult) => void;
}

export function useScan(options?: UseScanOptions): UseScanReturn {
  const [config, setConfig] = useState<ScanConfig | null>(null);
  const [usage, setUsage] = useState<ScanUsage | null>(null);
  const [nextAlarmAt, setNextAlarmAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [lastScanResult, setLastScanResult] = useState<ScanResult | null>(null);
  const mountedRef = useRef(true);
  const lastScanTimeRef = useRef(0);
  const scanInFlightRef = useRef(false);
  const quotaExhaustedRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const onScanCompleteRef = useRef(options?.onScanComplete);
  onScanCompleteRef.current = options?.onScanComplete;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/scan/status", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as {
        config: ScanConfig;
        usage: ScanUsage;
        nextAlarmAt: string | null;
      };
      if (mountedRef.current) {
        setConfig(data.config);
        setUsage(data.usage);
        setNextAlarmAt(data.nextAlarmAt);
      }
    } catch {
      // best-effort
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runScan = useCallback(async (bypassQuotaCheck = false) => {
    if (scanInFlightRef.current) {
      console.log("[useScan] Scan already in flight, skipping");
      return;
    }
    if (quotaExhaustedRef.current && !bypassQuotaCheck) {
      console.log("[useScan] Quota exhausted, skipping automatic scan");
      return;
    }
    const now = Date.now();
    if (now - lastScanTimeRef.current < DEBOUNCE_MS) {
      console.log(`[useScan] Debounced (${Math.round((DEBOUNCE_MS - (now - lastScanTimeRef.current)) / 1000)}s remaining)`);
      return;
    }

    scanInFlightRef.current = true;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const timeout = setTimeout(() => {
      console.warn(`[useScan] Scan timed out after ${SCAN_TIMEOUT_MS / 1000}s, aborting`);
      controller.abort();
    }, SCAN_TIMEOUT_MS);

    console.log("[useScan] Starting scan...");
    setScanning(true);
    try {
      const res = await fetch("/api/scan/trigger", {
        method: "POST",
        signal: controller.signal,
      });
      console.log(`[useScan] Response: ${res.status} ${res.statusText}`);
      if (res.ok) {
        const result = (await res.json()) as ScanResult;
        console.log("[useScan] Scan result:", result);
        lastScanTimeRef.current = Date.now();
        if (result.skipped === "scan_limit" || result.skipped === "token_limit") {
          quotaExhaustedRef.current = true;
          console.log("[useScan] Quota exhausted, pausing automatic scans");
        } else {
          quotaExhaustedRef.current = false;
        }
        if (mountedRef.current) {
          setLastScanResult(result);
          onScanCompleteRef.current?.(result);
        }
      }
      await refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (e instanceof DOMException && e.name === "AbortError") {
        console.warn("[useScan] Scan aborted (timeout or unmount)");
      } else {
        console.error("[useScan] Scan failed:", msg);
      }
    } finally {
      clearTimeout(timeout);
      scanInFlightRef.current = false;
      if (mountedRef.current) setScanning(false);
      console.log("[useScan] Scan cycle finished");
    }
  }, [refresh]);

  // Auto-trigger on mount
  useEffect(() => {
    void runScan();
  }, [runScan]);

  // Re-trigger on tab refocus — reset quota flag so we re-check
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        quotaExhaustedRef.current = false;
        void runScan();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [runScan]);

  // Periodic foreground re-scan
  useEffect(() => {
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") {
        void runScan();
      }
    }, FOREGROUND_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [runScan]);

  const updateConfig = useCallback(async (updates: Partial<ScanConfig>) => {
    setConfig((prev) => prev ? { ...prev, ...updates } : prev);
    try {
      const res = await fetch("/api/scan/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = (await res.json()) as { config: ScanConfig };
        if (mountedRef.current) setConfig(data.config);
      }
    } catch {
      await refresh();
    }
  }, [refresh]);

  const triggerScan = useCallback(async () => {
    setTriggering(true);
    lastScanTimeRef.current = 0;
    quotaExhaustedRef.current = false;
    try {
      await runScan(true);
    } finally {
      if (mountedRef.current) setTriggering(false);
    }
  }, [runScan]);

  return {
    config,
    usage,
    nextAlarmAt,
    loading,
    refresh,
    updateConfig,
    triggerScan,
    triggering,
    scanning,
    lastScanResult,
  };
}
