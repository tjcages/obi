import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useSyncExternalStore } from "react";
import { getThemePreference, setThemePreference, subscribeTheme, type ThemePreference } from "../components";
import { getMonoCategories, subscribeMonoCategories, setMonoCategories } from "../lib";
import { AccountAvatar } from "../components/ui/_account-avatar";
import {
  SectionLabel,
  SettingsCard,
  SettingsDropdown,
  SettingsRow,
  TagInput,
  Toggle,
} from "../components/settings";
import { NavStack, useNavStack } from "../components/nav-stack";
import {
  ALL_AGENT_ACTIONS,
  cn,
  useIsMobile,
  type AgentAction,
  type ConnectedAccountPublic,
  type PromptConfig,
} from "../lib";

// ── Provider / model config types ──

type ModelProvider = "workers-ai" | "openai" | "anthropic" | "google" | "groq";

interface ModelConfigResponse {
  provider: ModelProvider;
  modelId: string;
  apiKeyMasked?: string;
  hasApiKey: boolean;
}

interface ModelDef {
  id: string;
  label: string;
  desc: string;
  context: string;
}

interface ProviderDef {
  id: ModelProvider;
  name: string;
  desc: string;
  requiresKey: boolean;
  keyPlaceholder: string;
  models: ModelDef[];
}

const PROVIDERS: ProviderDef[] = [
  { id: "workers-ai", name: "Cloudflare Workers AI", desc: "Free, fast inference on Cloudflare's edge network. No API key needed.", requiresKey: false, keyPlaceholder: "",
    models: [
      { id: "@cf/meta/llama-4-scout-17b-16e-instruct", label: "Llama 4 Scout", desc: "Meta's latest multimodal MoE model with strong reasoning and tool use", context: "128K" },
      { id: "@cf/meta/llama-3.3-70b-instruct-fp8-fast", label: "Llama 3.3 70B", desc: "Meta's large instruction-tuned model, great for complex tasks", context: "128K" },
      { id: "@cf/qwen/qwen3-30b-a3b-fp8", label: "Qwen3 30B", desc: "Alibaba's latest MoE model with reasoning and multilingual support", context: "32K" },
      { id: "@cf/zai-org/glm-4.7-flash", label: "GLM 4.7 Flash", desc: "Fast and efficient multilingual model, optimized for dialogue", context: "128K" },
    ],
  },
  { id: "openai", name: "OpenAI", desc: "Industry-leading models from OpenAI. Requires an API key.", requiresKey: true, keyPlaceholder: "sk-...",
    models: [
      { id: "gpt-4o", label: "GPT-4o", desc: "Most capable multimodal model, best for complex reasoning", context: "128K" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", desc: "Fast and affordable for lightweight tasks", context: "128K" },
      { id: "o3-mini", label: "o3-mini", desc: "Reasoning model optimized for STEM and analysis", context: "200K" },
    ],
  },
  { id: "anthropic", name: "Anthropic", desc: "Claude models with strong instruction following. Requires an API key.", requiresKey: true, keyPlaceholder: "sk-ant-...",
    models: [
      { id: "claude-4-sonnet-20260514", label: "Claude 4 Sonnet", desc: "Latest generation with exceptional coding and reasoning", context: "200K" },
      { id: "claude-3-5-sonnet-20241022", label: "Claude 3.5 Sonnet", desc: "Excellent balance of speed and capability", context: "200K" },
      { id: "claude-3-haiku-20240307", label: "Claude 3 Haiku", desc: "Ultra-fast for simple tasks and quick responses", context: "200K" },
    ],
  },
  { id: "google", name: "Google AI", desc: "Gemini models with large context windows. Requires an API key.", requiresKey: true, keyPlaceholder: "AIza...",
    models: [
      { id: "gemini-2.5-pro-preview-05-06", label: "Gemini 2.5 Pro", desc: "Most capable model with built-in reasoning", context: "1M" },
      { id: "gemini-2.5-flash-preview-05-20", label: "Gemini 2.5 Flash", desc: "Fast model with thinking capabilities", context: "1M" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", desc: "Optimized for speed and everyday use", context: "1M" },
    ],
  },
  { id: "groq", name: "Groq", desc: "Ultra-fast inference with custom LPU hardware. Requires an API key.", requiresKey: true, keyPlaceholder: "gsk_...",
    models: [
      { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", desc: "Versatile large model on Groq's fast LPU infrastructure", context: "128K" },
      { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", desc: "Mixture-of-experts model, great cost-to-performance ratio", context: "32K" },
      { id: "gemma2-9b-it", label: "Gemma 2 9B", desc: "Google's compact open model, very fast on Groq", context: "8K" },
    ],
  },
];

const ACTION_LABELS: Record<AgentAction, string> = {
  read: "Read emails", send: "Send new", reply: "Reply", forward: "Forward",
  archive: "Archive", trash: "Trash", label: "Label / move", star: "Star / unstar",
};
const ACTION_DESCS: Record<AgentAction, string> = {
  read: "Allow the assistant to read your email contents",
  send: "Allow the assistant to compose and send new emails",
  reply: "Allow the assistant to reply to existing threads",
  forward: "Allow the assistant to forward emails to others",
  archive: "Allow the assistant to archive emails",
  trash: "Allow the assistant to move emails to trash",
  label: "Allow the assistant to apply or change labels",
  star: "Allow the assistant to star or unstar emails",
};

const NAV_GROUPS: { id: string; label: string; icon: React.ReactNode }[][] = [
  [
    { id: "model", label: "AI Model", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></> },
    { id: "behavior", label: "Behavior", icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" /></> },
    { id: "webSearch", label: "Web Search", icon: <><circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" /></> },
  ],
  [
    { id: "permissions", label: "Permissions", icon: <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /> },
    { id: "personalization", label: "Personalization", icon: <><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></> },
  ],
  [
    { id: "todoIntelligence", label: "To-do Intelligence", icon: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></> },
  ],
  [
    { id: "appearance", label: "Appearance", icon: <><circle cx="12" cy="12" r="10" /><path d="M12 2a7 7 0 000 20 4 4 0 010-8 4 4 0 000-8 4 4 0 010-4z" /></> },
  ],
];

// ── Dashboard section order ──

const DEFAULT_DASHBOARD_ORDER = ["todos", "mail", "projects", "slack", "chats"];

const DASHBOARD_SECTION_LABELS: Record<string, string> = {
  todos: "To-dos",
  mail: "Mail",
  projects: "Projects",
  slack: "Slack",
  chats: "Chats",
};

const DASHBOARD_SECTION_ICONS: Record<string, React.ReactNode> = {
  todos: <><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  mail: <><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 01-2.06 0L2 7" /></>,
  projects: <><path d="M2 20a2 2 0 002 2h16a2 2 0 002-2V8l-7 4V4a2 2 0 00-2-2H4a2 2 0 00-2 2v16z" /><path d="M17 8l5-3" /></>,
  slack: <><path d="M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z" /><path d="M20.5 10H19V8.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z" /><path d="M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z" /><path d="M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z" /><path d="M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z" /><path d="M15.5 19H14v1.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5-.67-1.5-1.5-1.5z" /><path d="M10 9.5C10 8.67 9.33 8 8.5 8h-5C2.67 8 2 8.67 2 9.5S2.67 11 3.5 11h5c.83 0 1.5-.67 1.5-1.5z" /><path d="M8.5 5H10V3.5C10 2.67 9.33 2 8.5 2S7 2.67 7 3.5 7.67 5 8.5 5z" /></>,
  chats: <><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" /></>,
};

// ── Scan types ──

interface ScanConfig {
  enabled: boolean;
  maxScansPerDay: number;
  maxTokensPerDay: number;
  scanIntervalActiveMs: number;
  scanIntervalInactiveMs: number;
}

interface ScanUsage {
  scansToday: number;
  tokensToday: number;
  lastScanAt: string | null;
  lastResetDate: string;
}

interface ScanStatus {
  config: ScanConfig;
  usage: ScanUsage;
  nextAlarmAt: string | null;
}

function formatScanTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const absDiff = Math.abs(diffMs);
  if (absDiff < 60_000) return diffMs > 0 ? "in less than a minute" : "just now";
  const mins = Math.round(absDiff / 60_000);
  if (mins < 60) return diffMs > 0 ? `in ${mins} min` : `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return diffMs > 0 ? `in ${hrs}h` : `${hrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

// ── Page ──

export default function SettingsPage({ userId, embedded }: { userId: string; embedded?: boolean }) {
  const [activeSection, setActiveSection] = useState("model");
  const [modelConfig, setModelConfig] = useState<ModelConfigResponse | null>(null);
  const [promptConfig, setPromptConfig] = useState<PromptConfig | null>(null);
  const [accounts, setAccounts] = useState<ConnectedAccountPublic[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [apiKeyDraft, setApiKeyDraft] = useState("");
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [expandedProvider, setExpandedProvider] = useState<ModelProvider | null>(null);
  const [scanConfig, setScanConfig] = useState<ScanConfig | null>(null);
  const [scanUsage, setScanUsage] = useState<ScanUsage | null>(null);
  const [scanNextAlarm, setScanNextAlarm] = useState<string | null>(null);
  const [scanTriggering, setScanTriggering] = useState(false);
  const [searchHasKey, setSearchHasKey] = useState(false);
  const [searchKeyMasked, setSearchKeyMasked] = useState<string | undefined>(undefined);
  const [searchKeyDraft, setSearchKeyDraft] = useState("");
  const [searchKeySaving, setSearchKeySaving] = useState(false);
  const [addToTop, setAddToTop] = useState(true);
  const [dashboardOrder, setDashboardOrder] = useState<string[]>(DEFAULT_DASHBOARD_ORDER);

  const themePreference = useSyncExternalStore(subscribeTheme, getThemePreference, () => "system" as ThemePreference);
  const monoCategories = useSyncExternalStore(subscribeMonoCategories, getMonoCategories, () => false);
  const initialPromptRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/settings/model").then((r) => r.json()) as Promise<{ config: ModelConfigResponse }>,
      fetch("/api/memory/system-prompt").then((r) => r.json()) as Promise<{ config: PromptConfig; defaultConfig: PromptConfig }>,
      fetch("/api/accounts").then((r) => r.json()).catch(() => ({ accounts: [] })) as Promise<{ accounts: ConnectedAccountPublic[] }>,
      fetch("/api/scan/status").then((r) => r.json()).catch(() => null) as Promise<ScanStatus | null>,
      fetch("/api/settings/search").then((r) => r.json()).catch(() => null) as Promise<{ config: { provider: string; apiKeyMasked?: string; hasApiKey: boolean } } | null>,
      fetch("/api/todos/preferences").then((r) => r.json()).catch(() => null) as Promise<{ addToTop?: boolean; dashboardSectionOrder?: string[] } | null>,
    ]).then(([m, p, a, s, search, todoPrefs]) => {
      if (cancelled) return;
      setModelConfig(m.config);
      setExpandedProvider(m.config.provider);
      setPromptConfig(p.config);
      setAccounts(a.accounts ?? []);
      initialPromptRef.current = JSON.stringify(p.config);
      if (s) { setScanConfig(s.config); setScanUsage(s.usage); setScanNextAlarm(s.nextAlarmAt); }
      if (search) { setSearchHasKey(search.config.hasApiKey); setSearchKeyMasked(search.config.apiKeyMasked); }
      if (todoPrefs && typeof todoPrefs.addToTop === "boolean") setAddToTop(todoPrefs.addToTop);
      if (todoPrefs?.dashboardSectionOrder?.length) setDashboardOrder(todoPrefs.dashboardSectionOrder);
      setLoading(false);
    }).catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const setModel = useCallback(async (modelId: string) => {
    if (!modelConfig) return;
    const res = await fetch("/api/settings/model", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: modelConfig.provider, modelId }) });
    if (res.ok) { const d = await res.json() as { config: ModelConfigResponse }; setModelConfig(d.config); }
  }, [modelConfig]);

  const saveApiKey = useCallback(async () => {
    if (!modelConfig || !apiKeyDraft.trim()) return;
    setApiKeySaving(true);
    const res = await fetch("/api/settings/model", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: modelConfig.provider, modelId: modelConfig.modelId, apiKey: apiKeyDraft.trim() }) });
    if (res.ok) { const d = await res.json() as { config: ModelConfigResponse }; setModelConfig(d.config); setApiKeyDraft(""); }
    setApiKeySaving(false);
  }, [modelConfig, apiKeyDraft]);

  const updatePrompt = useCallback(<K extends keyof PromptConfig>(key: K, value: PromptConfig[K]) => {
    setPromptConfig((prev) => prev ? { ...prev, [key]: value } : prev);
  }, []);

  const savePromptConfig = useCallback(async () => {
    if (!promptConfig) return;
    setSaving(true);
    const res = await fetch("/api/memory/system-prompt", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ config: promptConfig }) });
    if (res.ok) { initialPromptRef.current = JSON.stringify(promptConfig); setSaved(true); setTimeout(() => setSaved(false), 2000); }
    setSaving(false);
  }, [promptConfig]);

  const resetPromptConfig = useCallback(async () => {
    const res = await fetch("/api/memory/system-prompt", { method: "DELETE" });
    if (res.ok) { const d = await res.json() as { ok: boolean; config: PromptConfig }; setPromptConfig(d.config); initialPromptRef.current = JSON.stringify(d.config); }
  }, []);

  const updateScanConfig = useCallback(async (updates: Partial<ScanConfig>) => {
    const next = scanConfig ? { ...scanConfig, ...updates } : updates;
    setScanConfig(next as ScanConfig);
    const res = await fetch("/api/scan/config", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(updates) });
    if (res.ok) { const d = await res.json() as { config: ScanConfig }; setScanConfig(d.config); }
  }, [scanConfig]);

  const triggerScan = useCallback(async () => {
    setScanTriggering(true);
    try {
      await fetch("/api/scan/trigger", { method: "POST" });
      const statusRes = await fetch("/api/scan/status");
      if (statusRes.ok) { const s = await statusRes.json() as ScanStatus; setScanUsage(s.usage); setScanNextAlarm(s.nextAlarmAt); }
    } catch { /* best-effort */ }
    setScanTriggering(false);
  }, []);

  const saveSearchKey = useCallback(async () => {
    if (!searchKeyDraft.trim()) return;
    setSearchKeySaving(true);
    const res = await fetch("/api/settings/search", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "tavily", apiKey: searchKeyDraft.trim() }) });
    if (res.ok) {
      const d = await res.json() as { config: { hasApiKey: boolean; apiKeyMasked?: string } };
      setSearchHasKey(d.config.hasApiKey);
      setSearchKeyMasked(d.config.apiKeyMasked);
      setSearchKeyDraft("");
    }
    setSearchKeySaving(false);
  }, [searchKeyDraft]);

  const removeSearchKey = useCallback(async () => {
    const res = await fetch("/api/settings/search", { method: "DELETE" });
    if (res.ok) { setSearchHasKey(false); setSearchKeyMasked(undefined); }
  }, []);

  const updateAddToTop = useCallback(async (value: boolean) => {
    setAddToTop(value);
    await fetch("/api/todos/preferences", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ addToTop: value }),
    });
  }, []);

  const moveDashboardSection = useCallback((index: number, direction: -1 | 1) => {
    setDashboardOrder((prev) => {
      const next = [...prev];
      const targetIndex = index + direction;
      if (targetIndex < 0 || targetIndex >= next.length) return prev;
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      void fetch("/api/todos/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dashboardSectionOrder: next }),
      });
      return next;
    });
  }, []);

  const isMobile = useIsMobile();
  const nav = useNavStack();

  const selectSection = useCallback((id: string) => {
    setActiveSection(id);
    if (isMobile) {
      nav.push(id, { title: NAV_GROUPS.flat().find((s) => s.id === id)?.label, backLabel: "Settings" });
    }
  }, [isMobile, nav]);

  const promptDirty = promptConfig && initialPromptRef.current && JSON.stringify(promptConfig) !== initialPromptRef.current;

  if (loading) {
    return <div className="flex h-dvh items-center justify-center bg-background-100"><div className="h-5 w-5 animate-spin rounded-full border-2 border-foreground-300/30 border-t-foreground-300" /></div>;
  }

  const primaryAccount = accounts.find((a) => a.isPrimary) ?? accounts[0];
  const displayName = primaryAccount?.name ?? primaryAccount?.email?.split("@")[0] ?? userId.split("_")[0] ?? "User";
  const displayEmail = primaryAccount?.email ?? userId.replace(/_/g, "@").replace(/@([^@]*)$/, (_, d) => `@${d}`);

  const saveButton = (
    <AnimatePresence>
      {promptDirty && (
        <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} className="mb-5 flex items-center gap-3 lg:mb-6">
          <button type="button" onClick={() => void savePromptConfig()} disabled={saving} className="min-h-[44px] rounded-xl bg-accent-100 px-5 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 lg:min-h-0 lg:rounded-md lg:px-4 lg:py-[6px] lg:text-[13px]">
            {saving ? "Saving..." : "Save Changes"}
          </button>
          <button type="button" onClick={() => void resetPromptConfig()} className="min-h-[44px] rounded-xl border border-border-100/70 px-4 py-2.5 text-sm text-foreground-300 transition-colors hover:text-foreground-100 lg:min-h-0 lg:rounded-md lg:px-3 lg:py-[6px] lg:text-[13px]">
            Reset
          </button>
          {saved && <span className="text-[12px] text-green-500">Saved</span>}
        </motion.div>
      )}
    </AnimatePresence>
  );

  const sectionContent = (
    <>
      {activeSection === "model" && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">AI Model</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Configure which AI model powers your assistant</p>
          <SectionLabel>Provider</SectionLabel>
          <ProviderList
            providers={PROVIDERS}
            modelConfig={modelConfig}
            expandedProvider={expandedProvider}
            apiKeyDraft={apiKeyDraft}
            apiKeySaving={apiKeySaving}
            onExpandProvider={setExpandedProvider}
            onSetModel={setModel}
            onSetModelConfig={setModelConfig}
            onApiKeyChange={setApiKeyDraft}
            onSaveApiKey={saveApiKey}
          />
        </>
      )}

      {activeSection === "webSearch" && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">Web Search</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Let the assistant search the web for current information</p>
          <SectionLabel>Search Provider</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3.5 lg:px-5 lg:py-[14px]">
              <div className="flex items-start justify-between gap-3 sm:items-center">
                <div>
                  <div className="text-sm font-medium text-foreground-100 lg:text-[13.5px]">Tavily</div>
                  <div className="mt-0.5 text-[13px] leading-snug text-foreground-300 lg:text-[12.5px]">
                    AI-optimized search API.{" "}
                    <a href="https://tavily.com" target="_blank" rel="noopener noreferrer" className="text-accent-100 hover:underline">
                      Get an API key
                    </a>
                  </div>
                </div>
                {searchHasKey && (
                  <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-green-500/10 px-2.5 py-0.5 text-[11px] font-medium text-green-600 dark:text-green-400">
                    <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                    Connected
                  </span>
                )}
              </div>
            </div>
            <div className="border-t border-border-100/60 px-4 py-3.5 lg:px-5 lg:py-[14px]">
              {searchHasKey ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[13px] text-foreground-300 lg:text-[12.5px]">API Key</div>
                    <div className="mt-0.5 truncate font-mono text-sm text-foreground-200 lg:text-[13px]">{searchKeyMasked ?? "••••••••"}</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeSearchKey()}
                    className="min-h-[44px] shrink-0 rounded-lg border border-border-100/70 px-3 py-2 text-sm text-foreground-300 transition-colors hover:border-red-300 hover:text-red-500 lg:min-h-0 lg:rounded-md lg:py-[5px] lg:text-[12px]"
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <input
                    type="password"
                    value={searchKeyDraft}
                    onChange={(e) => setSearchKeyDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveSearchKey(); }}
                    placeholder="tvly-..."
                    className="min-h-[44px] flex-1 rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 font-mono text-sm text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:min-h-0 lg:rounded-md lg:py-[7px] lg:text-[13px]"
                  />
                  <button
                    type="button"
                    onClick={() => void saveSearchKey()}
                    disabled={searchKeySaving || !searchKeyDraft.trim()}
                    className="min-h-[44px] rounded-lg bg-accent-100 px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50 lg:min-h-0 lg:rounded-md lg:py-[7px] lg:text-[12.5px]"
                  >
                    {searchKeySaving ? "Saving..." : "Save"}
                  </button>
                </div>
              )}
            </div>
          </SettingsCard>
          <div className="mt-3 rounded-xl border border-border-100/40 bg-background-200/30 px-4 py-3 lg:mt-4 lg:rounded-lg">
            <p className="text-[13px] leading-relaxed text-foreground-300 lg:text-[12.5px]">
              When enabled, the assistant can search the web to answer questions about current events, people, companies, or topics beyond your email.
              Tavily offers 1,000 free searches per month.
            </p>
          </div>
        </>
      )}

      {activeSection === "behavior" && promptConfig && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">Behavior</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Configure how the assistant responds and formats output</p>
          <SectionLabel>Defaults</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3.5 lg:px-5 lg:py-[14px]">
              <div className="text-sm font-medium text-foreground-100 lg:text-[13.5px]">Persona</div>
              <div className="mt-0.5 text-[13px] leading-snug text-foreground-300 lg:text-[12.5px]">The assistant&apos;s identity or name</div>
              <input
                type="text"
                value={promptConfig.persona}
                onChange={(e) => updatePrompt("persona", e.target.value)}
                placeholder="Email Assistant"
                className="mt-3 w-full rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 text-sm text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:rounded-md lg:py-[7px] lg:text-[13px]"
              />
            </div>
            <SettingsRow label="Tone" desc="How verbose the assistant's replies should be">
              <SettingsDropdown value={promptConfig.tone} options={[{ value: "concise" as const, label: "Concise" }, { value: "balanced" as const, label: "Balanced" }, { value: "detailed" as const, label: "Detailed" }]} onChange={(v) => updatePrompt("tone", v)} />
            </SettingsRow>
            <SettingsRow label="Response Format" desc="Default structure for organizing information">
              <SettingsDropdown value={promptConfig.responseFormat} options={[{ value: "bullets" as const, label: "Bullets" }, { value: "narrative" as const, label: "Narrative" }, { value: "structured" as const, label: "Structured" }]} onChange={(v) => updatePrompt("responseFormat", v)} />
            </SettingsRow>
            <SettingsRow label="Language" desc="Primary language for responses">
              <SettingsDropdown value={promptConfig.language} options={[
                { value: "English", label: "English" },
                { value: "Spanish", label: "Spanish" },
                { value: "French", label: "French" },
                { value: "German", label: "German" },
                { value: "Italian", label: "Italian" },
                { value: "Portuguese", label: "Portuguese" },
                { value: "Dutch", label: "Dutch" },
                { value: "Russian", label: "Russian" },
                { value: "Chinese", label: "Chinese" },
                { value: "Japanese", label: "Japanese" },
                { value: "Korean", label: "Korean" },
                { value: "Arabic", label: "Arabic" },
                { value: "Hindi", label: "Hindi" },
              ]} onChange={(v) => updatePrompt("language", v)} />
            </SettingsRow>
            <SettingsRow label="Default Email Count" desc="How many emails to fetch per query">
              <SettingsDropdown value={String(promptConfig.defaultEmailCount)} options={[5, 10, 20, 50].map((n) => ({ value: String(n), label: String(n) }))} onChange={(v) => updatePrompt("defaultEmailCount", parseInt(v, 10))} />
            </SettingsRow>
          </SettingsCard>
          <SectionLabel>Custom Instructions</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3.5 lg:px-5 lg:py-4">
              <textarea value={promptConfig.customInstructions} onChange={(e) => updatePrompt("customInstructions", e.target.value)} rows={3} placeholder="Additional instructions appended to every prompt, e.g. 'Always respond in bullet points.'" className="w-full resize-none rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 text-sm leading-relaxed text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:rounded-md lg:py-2 lg:text-[13px]" />
            </div>
          </SettingsCard>
          {saveButton}
        </>
      )}

      {activeSection === "permissions" && promptConfig && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">Permissions</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Control what actions the assistant can perform on your behalf</p>
          <SectionLabel>Safety</SectionLabel>
          <SettingsCard>
            <SettingsRow label="Confirm Before Actions" desc="Ask for confirmation before sending, trashing, or modifying emails" onClick={() => updatePrompt("confirmBeforeActions", !promptConfig.confirmBeforeActions)}>
              <Toggle checked={promptConfig.confirmBeforeActions} onChange={(v) => updatePrompt("confirmBeforeActions", v)} />
            </SettingsRow>
          </SettingsCard>
          <SectionLabel>Allowed Actions</SectionLabel>
          <SettingsCard>
            {ALL_AGENT_ACTIONS.map((action) => (
              <SettingsRow key={action} label={ACTION_LABELS[action]} desc={ACTION_DESCS[action]} onClick={() => {
                const on = promptConfig.allowedActions.includes(action);
                updatePrompt("allowedActions", on
                  ? promptConfig.allowedActions.filter((a) => a !== action)
                  : [...promptConfig.allowedActions, action]);
              }}>
                <Toggle
                  checked={promptConfig.allowedActions.includes(action)}
                  onChange={(checked) => {
                    updatePrompt("allowedActions", checked
                      ? [...promptConfig.allowedActions, action]
                      : promptConfig.allowedActions.filter((a) => a !== action));
                  }}
                />
              </SettingsRow>
            ))}
          </SettingsCard>
          {saveButton}
        </>
      )}

      {activeSection === "personalization" && promptConfig && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">Personalization</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Help the assistant understand your priorities and preferences</p>
          <SectionLabel>Priority Contacts</SectionLabel>
          <SettingsCard><TagInput tags={promptConfig.priorityContacts} onChange={(tags) => updatePrompt("priorityContacts", tags)} placeholder="Add a contact email..." /></SettingsCard>
          <SectionLabel>Focus Topics</SectionLabel>
          <SettingsCard><TagInput tags={promptConfig.focusTopics} onChange={(tags) => updatePrompt("focusTopics", tags)} placeholder="Add a topic..." /></SettingsCard>
          {saveButton}
        </>
      )}

      {activeSection === "todoIntelligence" && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">To-do Intelligence</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Automatically scan your inbox and suggest actionable to-do items</p>
          <SectionLabel>List Behavior</SectionLabel>
          <SettingsCard>
            <SettingsRow label="Add new items to top" desc="New to-do items appear at the top of the list instead of the bottom" onClick={() => void updateAddToTop(!addToTop)}>
              <Toggle checked={addToTop} onChange={(v) => void updateAddToTop(v)} />
            </SettingsRow>
          </SettingsCard>
          <ScanSection
            scanConfig={scanConfig}
            scanUsage={scanUsage}
            scanNextAlarm={scanNextAlarm}
            scanTriggering={scanTriggering}
            onUpdateConfig={updateScanConfig}
            onTriggerScan={triggerScan}
          />
        </>
      )}

      {activeSection === "appearance" && (
        <>
          <h1 className="text-lg font-semibold text-foreground-100 lg:text-[22px]">Appearance</h1>
          <p className="mt-1 mb-5 text-sm text-foreground-300 lg:mb-7 lg:text-[13.5px]">Customize how the interface looks and feels</p>
          <SectionLabel>Theme</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3.5 lg:px-5 lg:py-[14px]">
              <div className="text-sm font-medium text-foreground-100 lg:text-[13.5px]">Color Mode</div>
              <div className="mt-0.5 text-[13px] leading-snug text-foreground-300 lg:text-[12.5px]">Choose between light, dark, or system appearance</div>
              <div className="mt-3 inline-flex rounded-lg border border-border-100/70 bg-background-200/40 p-0.5">
                {([
                  { value: "light" as ThemePreference, label: "Light", icon: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></> },
                  { value: "system" as ThemePreference, label: "System", icon: <><rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" /></> },
                  { value: "dark" as ThemePreference, label: "Dark", icon: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /> },
                ]).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setThemePreference(opt.value)}
                    className={cn(
                      "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors lg:text-[13px]",
                      themePreference === opt.value
                        ? "bg-background-100 text-foreground-100 shadow-sm"
                        : "text-foreground-300 hover:text-foreground-200",
                    )}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{opt.icon}</svg>
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </SettingsCard>
          <div className="mt-5" />
          <SectionLabel>To-dos</SectionLabel>
          <SettingsCard>
            <SettingsRow label="Mono Projects" desc="Use a uniform muted style for project badges instead of colors" onClick={() => setMonoCategories(!monoCategories)}>
              <Toggle checked={monoCategories} onChange={() => setMonoCategories(!monoCategories)} />
            </SettingsRow>
          </SettingsCard>
          <div className="mt-5" />
          <SectionLabel>Dashboard Sections</SectionLabel>
          <SettingsCard>
            <div className="px-4 py-3 lg:px-5 lg:py-3">
              <div className="text-sm font-medium text-foreground-100 lg:text-[13.5px]">Section Order</div>
              <div className="mt-0.5 mb-3 text-[13px] leading-snug text-foreground-300 lg:text-[12.5px]">Drag sections to reorder how they appear on your dashboard</div>
              <div className="space-y-1">
                {dashboardOrder.map((sectionId, index) => (
                  <div
                    key={sectionId}
                    className="flex items-center gap-3 rounded-lg bg-foreground-100/3 px-3 py-2.5 lg:py-2"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">
                      {DASHBOARD_SECTION_ICONS[sectionId]}
                    </svg>
                    <span className="flex-1 text-[14px] font-medium text-foreground-100 lg:text-[13px]">
                      {DASHBOARD_SECTION_LABELS[sectionId] ?? sectionId}
                    </span>
                    <div className="flex items-center gap-0.5">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => moveDashboardSection(index, -1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-300 transition-colors hover:bg-foreground-100/8 hover:text-foreground-100 disabled:opacity-20 disabled:pointer-events-none"
                        aria-label="Move up"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 15l-6-6-6 6" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        disabled={index === dashboardOrder.length - 1}
                        onClick={() => moveDashboardSection(index, 1)}
                        className="flex h-7 w-7 items-center justify-center rounded-md text-foreground-300 transition-colors hover:bg-foreground-100/8 hover:text-foreground-100 disabled:opacity-20 disabled:pointer-events-none"
                        aria-label="Move down"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </SettingsCard>
        </>
      )}
    </>
  );

  if (isMobile) {
    return (
      <NavStack
        nav={nav}
        className={cn(embedded ? "h-full" : "h-dvh", "bg-background-100 text-foreground-100")}
        renderPage={() => (
          <div className="px-4 py-5">
            {sectionContent}
            <div className="mt-8 pb-8 text-[12px] leading-relaxed text-foreground-300/50">
              API keys are stored securely in your account&apos;s private storage, never shared or logged. Configuration changes take effect on the next message.
            </div>
          </div>
        )}
      >
        <div className="px-4 py-4">
          <SettingsNav
            activeSection={activeSection}
            accounts={accounts}
            displayName={displayName}
            displayEmail={displayEmail}
            onSelect={selectSection}
            isMobile={true}
            embedded={embedded}
          />
        </div>
      </NavStack>
    );
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background-100 text-foreground-100">
      <div className="mx-auto flex max-w-[1060px] gap-10 px-8 py-10 pt-14">
        <SettingsNav
          activeSection={activeSection}
          accounts={accounts}
          displayName={displayName}
          displayEmail={displayEmail}
          onSelect={selectSection}
          isMobile={false}
        />
        <div className="min-w-0 flex-1">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
            >
              {sectionContent}
            </motion.div>
          </AnimatePresence>

          <div className="mt-8 pb-8 text-[12px] leading-relaxed text-foreground-300/50 lg:text-[11.5px]">
            API keys are stored securely in your account's private storage, never shared or logged. Configuration changes take effect on the next message.
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ──

function SettingsNav({
  activeSection,
  accounts,
  displayName,
  displayEmail,
  onSelect,
  isMobile,
  embedded,
}: {
  activeSection: string;
  accounts: ConnectedAccountPublic[];
  displayName: string;
  displayEmail: string;
  onSelect: (id: string) => void;
  isMobile: boolean;
  embedded?: boolean;
}) {
  if (isMobile) {
    return (
      <nav className="w-full">
        {!embedded && (
          <a href="/" className="mb-2 flex h-11 items-center gap-0 px-0 text-[17px] text-accent-100 transition-opacity active:opacity-50">
            <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6" /></svg>
            Home
          </a>
        )}
        {!embedded && (
          <div className="mb-5">
            <h1 className="text-[28px] font-bold tracking-tight text-foreground-100">Settings</h1>
            <div className="mt-1 text-[15px] text-foreground-300/60">{displayName} &middot; {displayEmail}</div>
          </div>
        )}
        {embedded && (
          <div className="mb-4 mt-1">
            <div className="text-[15px] text-foreground-300/60">{displayName} &middot; {displayEmail}</div>
          </div>
        )}
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi} className={cn(gi > 0 && "mt-5 border-t border-foreground-100/6 pt-5")}>
            {group.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelect(item.id)}
                className="flex w-full items-center gap-2.5 py-[9px] text-left transition-colors active:opacity-60"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/50">{item.icon}</svg>
                <span className="flex-1 text-[17px] text-foreground-100">{item.label}</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-foreground-300/25">
                  <path d="M9 18l6-6-6-6" />
                </svg>
              </button>
            ))}
          </div>
        ))}
        {accounts.length > 0 && (
          <div className="mt-5 border-t border-foreground-100/6 pt-5">
            <div className="mb-2.5 text-[13px] font-normal uppercase tracking-wide text-foreground-300/50">Accounts</div>
            <div className="space-y-3">
              {accounts.map((acct) => (
                <div key={acct.email} className="flex items-center gap-2.5">
                  <AccountAvatar account={acct} size={24} />
                  <span className="truncate text-[15px] text-foreground-300/70">{acct.label || acct.email}</span>
                  {acct.isPrimary && <span className="ml-auto shrink-0 rounded bg-accent-100/15 px-1.5 py-0.5 text-[10px] font-medium text-accent-100">Primary</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </nav>
    );
  }

  return (
    <nav className="w-[240px] shrink-0 pt-1">
      <div className="sticky top-10">
        <a href="/" className="mb-5 flex items-center gap-1.5 px-3 text-[13px] text-foreground-300/60 transition-colors hover:text-foreground-200">
          <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5" /><path d="M12 19l-7-7 7-7" /></svg>
          Inbox
        </a>
        <div className="mb-7 px-3">
          <div className="flex items-center gap-1.5">
            <span className="text-[13.5px] font-medium text-foreground-200">{displayName}</span>
          </div>
          <div className="mt-0.5 truncate text-[11.5px] text-foreground-300/60">{displayEmail}</div>
        </div>
        {NAV_GROUPS.map((group, gi) => (
          <div key={gi}>
            {gi > 0 && <div className="mx-3 my-3 border-t border-foreground-300/10" />}
            <div className="space-y-px">
              {group.map((item) => (
                <button key={item.id} type="button" onClick={() => onSelect(item.id)} className={cn("flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left text-[13.5px] transition-colors", activeSection === item.id ? "bg-foreground-100/8 font-medium text-foreground-100" : "text-foreground-300/80 hover:text-foreground-200")}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 opacity-60">{item.icon}</svg>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        ))}
        {accounts.length > 0 && (
          <>
            <div className="mx-3 my-3 border-t border-foreground-300/10" />
            <div className="px-3">
              <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">Accounts</div>
              <div className="space-y-1.5">
                {accounts.map((acct) => (
                  <div key={acct.email} className="flex items-center gap-2">
                    <AccountAvatar account={acct} size={20} />
                    <span className="truncate text-[12px] text-foreground-300/70">{acct.label || acct.email}</span>
                    {acct.isPrimary && <span className="ml-auto shrink-0 rounded bg-accent-100/15 px-1.5 py-px text-[9px] font-medium text-accent-100">Primary</span>}
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </nav>
  );
}

function ProviderList({
  providers, modelConfig, expandedProvider, apiKeyDraft, apiKeySaving,
  onExpandProvider, onSetModel, onSetModelConfig, onApiKeyChange, onSaveApiKey,
}: {
  providers: ProviderDef[];
  modelConfig: ModelConfigResponse | null;
  expandedProvider: ModelProvider | null;
  apiKeyDraft: string;
  apiKeySaving: boolean;
  onExpandProvider: (p: ModelProvider | null) => void;
  onSetModel: (modelId: string) => Promise<void>;
  onSetModelConfig: (config: ModelConfigResponse) => void;
  onApiKeyChange: (v: string) => void;
  onSaveApiKey: () => Promise<void>;
}) {
  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-border-100/70 lg:mb-6 lg:rounded-lg">
      {providers.map((prov, pi) => {
        const isActive = modelConfig?.provider === prov.id;
        const isExpanded = expandedProvider === prov.id;
        return (
          <div key={prov.id} className={pi > 0 ? "border-t border-border-100/50" : ""}>
            <button type="button" onClick={() => onExpandProvider(isExpanded ? null : prov.id)} className={cn("flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors lg:px-5 lg:py-[14px]", isActive ? "bg-accent-100/4" : "hover:bg-foreground-100/2")}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5 lg:gap-2">
                  <span className={cn("text-sm font-medium lg:text-[13.5px]", isActive ? "text-accent-100" : "text-foreground-100")}>{prov.name}</span>
                  {isActive && <span className="rounded bg-accent-100/15 px-1.5 py-px text-[10px] font-medium text-accent-100">Active</span>}
                  {!prov.requiresKey && <span className="rounded bg-green-500/15 px-1.5 py-px text-[10px] font-medium text-green-500">Free</span>}
                </div>
                <div className="mt-0.5 text-[13px] leading-snug text-foreground-300 lg:text-[12px]">{prov.desc}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="hidden text-[11px] text-foreground-300/50 sm:inline">{prov.models.length} models</span>
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={cn("shrink-0 text-foreground-300/40 transition-transform duration-200", isExpanded && "rotate-180")}><path d="M6 9l6 6 6-6" /></svg>
              </div>
            </button>
            <AnimatePresence>
              {isExpanded && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                  <div className="border-t border-border-100/30 bg-foreground-100/1.5">
                    <div className="px-3 pt-3 pb-4 lg:px-5 lg:pb-5">
                      <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">Models</div>
                      <div className="space-y-1">
                        {prov.models.map((model) => {
                          const isModelActive = isActive && modelConfig?.modelId === model.id;
                          return (
                            <button key={model.id} type="button" onClick={() => {
                              if (isActive) { void onSetModel(model.id); } else {
                                void (async () => {
                                  const res = await fetch("/api/settings/model", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: prov.id, modelId: model.id }) });
                                  if (res.ok) { const d = await res.json() as { config: ModelConfigResponse }; onSetModelConfig(d.config); }
                                })();
                              }
                            }} className={cn("flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition-colors lg:rounded-lg lg:py-2.5", isModelActive ? "bg-accent-100/10 ring-1 ring-accent-100/25" : "hover:bg-foreground-100/5")}>
                              <div className={cn("flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors lg:h-4 lg:w-4", isModelActive ? "border-accent-100 bg-accent-100" : "border-foreground-300/30")}>
                                {isModelActive && <div className="h-2 w-2 rounded-full bg-white lg:h-1.5 lg:w-1.5" />}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className={cn("text-sm font-medium lg:text-[13px]", isModelActive ? "text-accent-100" : "text-foreground-100")}>{model.label}</div>
                                <div className="mt-0.5 text-[12px] leading-snug text-foreground-300/70 lg:text-[11.5px]">{model.desc}</div>
                              </div>
                              <span className="shrink-0 rounded bg-foreground-100/5 px-1.5 py-0.5 text-[10px] font-medium text-foreground-300/60">{model.context}</span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    {prov.requiresKey && (
                      <div className="mt-2 border-t border-border-100/30 px-4 py-3 lg:px-5">
                        <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-foreground-300/50">API Key</div>
                        {isActive && modelConfig?.hasApiKey && (
                          <div className="mb-2 flex items-center gap-1.5 text-[12px] text-green-500">
                            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                            Key saved: {modelConfig.apiKeyMasked}
                          </div>
                        )}
                        <div className="flex items-center gap-2">
                          <input type="password" value={apiKeyDraft} onChange={(e) => onApiKeyChange(e.target.value)} placeholder={isActive && modelConfig?.hasApiKey ? "Replace existing key..." : prov.keyPlaceholder} className="min-h-[44px] flex-1 rounded-lg border border-border-100/70 bg-background-200/60 px-3 py-2.5 text-sm text-foreground-100 placeholder:text-foreground-300/40 focus:border-accent-100/50 focus:outline-none lg:min-h-0 lg:rounded-md lg:py-[5px] lg:text-[13px]" />
                          <button type="button" onClick={() => void onSaveApiKey()} disabled={!apiKeyDraft.trim() || apiKeySaving} className="min-h-[44px] rounded-lg border border-border-100/70 px-3 py-2.5 text-sm text-foreground-300 transition-colors hover:text-foreground-100 disabled:opacity-30 lg:min-h-0 lg:rounded-md lg:py-[5px] lg:text-[12px]">
                            {apiKeySaving ? "..." : "Save Key"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        );
      })}
    </div>
  );
}

function ScanSection({
  scanConfig, scanUsage, scanNextAlarm, scanTriggering,
  onUpdateConfig, onTriggerScan,
}: {
  scanConfig: ScanConfig | null;
  scanUsage: ScanUsage | null;
  scanNextAlarm: string | null;
  scanTriggering: boolean;
  onUpdateConfig: (updates: Partial<ScanConfig>) => Promise<void>;
  onTriggerScan: () => Promise<void>;
}) {
  return (
    <>
      <SectionLabel>Background Scanning</SectionLabel>
      <SettingsCard>
        <SettingsRow label="Enable inbox scanning" desc="Periodically analyze your inbox for actionable emails and suggest to-do items" onClick={() => void onUpdateConfig({ enabled: !(scanConfig?.enabled ?? true) })}>
          <Toggle checked={scanConfig?.enabled ?? true} onChange={(v) => void onUpdateConfig({ enabled: v })} />
        </SettingsRow>
      </SettingsCard>

      {scanConfig?.enabled !== false && (
        <>
          <SectionLabel>Daily Limits</SectionLabel>
          <SettingsCard>
            <SettingsRow label="Max scans per day" desc="How many times the scanner runs each day">
              <SettingsDropdown value={String(scanConfig?.maxScansPerDay ?? 8)} options={[{ value: "4", label: "4 scans" }, { value: "8", label: "8 scans" }, { value: "12", label: "12 scans" }, { value: "16", label: "16 scans" }, { value: "99", label: "Unlimited" }]} onChange={(v) => void onUpdateConfig({ maxScansPerDay: Number(v) })} />
            </SettingsRow>
            <SettingsRow label="Daily token budget" desc="Maximum AI tokens used for scanning per day">
              <SettingsDropdown value={String(scanConfig?.maxTokensPerDay ?? 100_000)} options={[{ value: "50000", label: "50K tokens" }, { value: "100000", label: "100K tokens" }, { value: "250000", label: "250K tokens" }, { value: "500000", label: "500K tokens" }, { value: "10000000", label: "Unlimited" }]} onChange={(v) => void onUpdateConfig({ maxTokensPerDay: Number(v) })} />
            </SettingsRow>
          </SettingsCard>

          <SectionLabel>Status</SectionLabel>
          <SettingsCard>
            <div className="space-y-3 px-4 py-3.5 lg:px-5 lg:py-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-200 lg:text-[13px]">Scans today</span>
                <span className="text-sm font-medium text-foreground-100 lg:text-[13px]">
                  {scanUsage?.scansToday ?? 0} / {(scanConfig?.maxScansPerDay ?? 8) >= 99 ? "∞" : scanConfig?.maxScansPerDay ?? 8}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-foreground-100/10 lg:h-1.5">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, ((scanUsage?.scansToday ?? 0) / Math.max(1, scanConfig?.maxScansPerDay ?? 8)) * 100)}%` }} />
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground-200 lg:text-[13px]">Tokens used today</span>
                <span className="text-sm font-medium text-foreground-100 lg:text-[13px]">
                  {((scanUsage?.tokensToday ?? 0) / 1000).toFixed(1)}K / {(scanConfig?.maxTokensPerDay ?? 100_000) >= 10_000_000 ? "∞" : `${((scanConfig?.maxTokensPerDay ?? 100_000) / 1000).toFixed(0)}K`}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-foreground-100/10 lg:h-1.5">
                <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${Math.min(100, ((scanUsage?.tokensToday ?? 0) / Math.max(1, scanConfig?.maxTokensPerDay ?? 100_000)) * 100)}%` }} />
              </div>
              {scanUsage?.lastScanAt && (
                <div className="flex items-center justify-between pt-1">
                  <span className="text-[13px] text-foreground-300 lg:text-[12px]">Last scanned</span>
                  <span className="text-[13px] text-foreground-300 lg:text-[12px]">{formatScanTime(scanUsage.lastScanAt)}</span>
                </div>
              )}
              {scanNextAlarm && (
                <div className="flex items-center justify-between">
                  <span className="text-[13px] text-foreground-300 lg:text-[12px]">Next scan</span>
                  <span className="text-[13px] text-foreground-300 lg:text-[12px]">{formatScanTime(scanNextAlarm)}</span>
                </div>
              )}
            </div>
            <div className="border-t border-border-100/50 px-4 py-3 lg:px-5">
              <button type="button" onClick={() => void onTriggerScan()} disabled={scanTriggering} className="flex min-h-[44px] items-center gap-2 rounded-xl border border-border-100/70 px-4 py-2.5 text-sm font-medium text-foreground-200 transition-colors hover:border-foreground-300 hover:text-foreground-100 disabled:opacity-40 lg:min-h-0 lg:rounded-md lg:px-3 lg:py-[6px] lg:text-[12.5px]">
                {scanTriggering ? (
                  <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-foreground-300 border-t-blue-500" />
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 4 23 10 17 10" /><path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" /></svg>
                )}
                Scan now
              </button>
            </div>
          </SettingsCard>
        </>
      )}
    </>
  );
}
