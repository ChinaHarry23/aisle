"use client";

import { ModelTable, type ModelRow } from "@/components/settings/ModelTable";
import { ProfileSection } from "@/components/settings/ProfileSection";
import {
  MediaKeyEditor,
  ProviderRow,
  WorkspaceKeyField,
  type TestControl,
} from "@/components/settings/ProviderRow";
import { PageHeader } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  canTest,
  connectionState,
  isConnected,
  readDeviceKeys,
  rowId,
  testConnection,
  type ConnectionKind,
  type ConnectionState,
  type ConnectionTestResult,
  type ServerStatus,
} from "@/lib/connections";
import { formatUsd } from "@/lib/ids";
import {
  AGENT_SLOTS,
  getLlmOrDefault,
  LLM_MODELS,
  LLM_PROVIDERS,
  OFFERED_LLM_PROVIDERS,
} from "@/lib/llm/catalog";
import {
  matchPreset,
  PRESET_PROVIDERS,
  presetAssignments,
  PRESETS,
  textCostPerRun,
} from "@/lib/llm/presets";
import type { AgentSlot, LlmProviderId } from "@/lib/llm/types";
import { getByoKey } from "@/lib/media/byo-key";
import {
  ENABLED_IMAGE_PROVIDERS,
  getModelOrDefault,
  modelsOf,
  PROVIDERS,
} from "@/lib/media/catalog";
import { quoteModel } from "@/lib/media/estimate";
import type { MediaModel, ProviderId } from "@/lib/media/types";
import { useAisle } from "@/lib/store";
import { useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";

const TABS = [
  { id: "models", label: "Models" },
  { id: "connections", label: "Connections" },
  { id: "account", label: "Profile" },
] as const;
type TabId = (typeof TABS)[number]["id"];

/* ---- Tab and deep link live in the URL hash: #connections or #connections/llm:openai ---- */

function subscribeHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function parseHash(hash: string): { tab: TabId; row: string | null } {
  const [head, target] = hash.split("/");
  const tab = TABS.find((t) => t.id === head)?.id ?? "models";
  const [kind, provider] = (target ?? "").split(":");
  const row = (kind === "llm" || kind === "image") && provider ? rowId(kind, provider) : null;
  return { tab, row };
}

/* ---- Shared connection state, read by both tabs ---- */

type Conn = {
  /** False until the server status and device keys have loaded, so we never flash "Not connected". */
  ready: boolean;
  stateOf: (kind: ConnectionKind, providerId: string) => ConnectionState;
  /** True when a step using this provider can be expected to work (or we do not know yet). */
  ok: (kind: ConnectionKind, providerId: string) => boolean;
  goConnect: (kind: ConnectionKind, providerId: string) => void;
};

const IMAGE_PROVIDER_IDS = PROVIDERS.filter((p) => ENABLED_IMAGE_PROVIDERS.includes(p.id)).map((p) => p.id);

function mediaRows(kind: MediaModel["kind"], conn: Conn): ModelRow[] {
  return modelsOf(kind).map((m) => ({
    id: m.id,
    name: m.name,
    providerId: m.providerId,
    provider: m.provider,
    bestFor: m.bestFor,
    cost: m.estimateLabel,
    connected: conn.ok("image", m.providerId),
    note: m.notes,
  }));
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="font-serif text-lg">{title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{description}</p>
      </div>
      {children}
    </section>
  );
}

function Disclosure({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <details className="group hairline">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 px-4 py-3">
        <span>
          <span className="block text-sm font-semibold">{title}</span>
          <span className="block text-xs text-mute">{description}</span>
        </span>
        <span aria-hidden className="mt-0.5 text-xs text-mute transition group-open:rotate-90">
          ▸
        </span>
      </summary>
      <div className="border-t border-line">{children}</div>
    </details>
  );
}

function ConnectLink({ conn, kind, providerId, name }: { conn: Conn; kind: ConnectionKind; providerId: string; name: string }) {
  return (
    <button
      type="button"
      onClick={() => conn.goConnect(kind, providerId)}
      className="font-medium text-signal underline-offset-2 hover:underline"
    >
      Connect {name}
    </button>
  );
}

/* ------------------------------ Models tab ------------------------------ */

function ModelsTab({ conn }: { conn: Conn }) {
  const settings = useAisle((s) => s.settings);
  const updateSettings = useAisle((s) => s.updateSettings);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [pickedProvider, setPickedProvider] = useState<LlmProviderId | null>(null);

  const imageRows = useMemo(() => mediaRows("image", conn), [conn]);
  const image = getModelOrDefault(settings.imageModelId, "image");
  const imageProviderName = PROVIDERS.find((p) => p.id === image.providerId)?.name ?? image.provider;

  const presetProvider: LlmProviderId =
    pickedProvider ??
    (PRESET_PROVIDERS.includes(settings.agents.trend.provider) ? settings.agents.trend.provider : "openai");
  const activePreset = matchPreset(presetProvider, settings.agents);
  const presetProviderOk = conn.ok("llm", presetProvider);
  const presetProviderName = LLM_PROVIDERS.find((p) => p.id === presetProvider)?.name ?? presetProvider;

  const textCost = textCostPerRun(settings.agents);
  const imageCost = quoteModel(image.id).costUsd;

  return (
    <div className="flex flex-col gap-10">
      <div className="hairline flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 px-4 py-3">
        <p className="text-sm">
          <span className="text-ink-soft">Estimated cost per campaign </span>
          <strong className="tabular-nums">~{formatUsd(textCost + imageCost)}</strong>
        </p>
        <p className="text-xs text-mute">
          Text agents {formatUsd(textCost)} + one image {formatUsd(imageCost)}. One call per agent; real usage varies.
        </p>
      </div>

      <Section
        title="Image generation"
        description="Creates the poster and ad visuals. Estimates are per ad."
      >
        <ModelTable
          label="Image generation model"
          rows={imageRows}
          value={image.id}
          onChange={(id) => updateSettings({ imageModelId: id })}
        />
        {!conn.ok("image", image.providerId) ? (
          <p className="text-sm text-ink-soft">
            {imageProviderName} isn&rsquo;t connected.{" "}
            <ConnectLink conn={conn} kind="image" providerId={image.providerId} name={imageProviderName} />
          </p>
        ) : null}
      </Section>

      <Section
        title="Agent assignments"
        description="The language model behind each agent in the campaign pipeline. Pick a preset, or fine-tune each agent under Advanced."
      >
        <div className="hairline flex flex-col gap-4 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label htmlFor="preset-provider" className="text-xs font-medium text-ink-soft">
              Provider
            </label>
            <select
              id="preset-provider"
              value={presetProvider}
              onChange={(e) => setPickedProvider(e.target.value as LlmProviderId)}
              className="border px-3 py-1.5 text-sm"
            >
              {PRESET_PROVIDERS.filter((p) => OFFERED_LLM_PROVIDERS.includes(p)).map((p) => (
                <option key={p} value={p}>
                  {LLM_PROVIDERS.find((x) => x.id === p)?.name}
                  {conn.ok("llm", p) ? "" : " (not connected)"}
                </option>
              ))}
            </select>
            {!presetProviderOk ? (
              <span className="text-xs text-ink-soft">
                <ConnectLink conn={conn} kind="llm" providerId={presetProvider} name={presetProviderName} /> to use
                presets.
              </span>
            ) : null}
          </div>

          <div role="radiogroup" aria-label="Model preset" className="grid gap-2 md:grid-cols-3">
            {PRESETS.map((p) => {
              const next = presetAssignments(presetProvider, p.id);
              const selected = activePreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={!presetProviderOk || !next}
                  onClick={() => next && updateSettings({ agents: next })}
                  className={cn(
                    "flex flex-col gap-1 rounded-[var(--r-card)] border px-3 py-3 text-left transition disabled:opacity-50",
                    selected ? "border-signal bg-signal-soft" : "border-line bg-surface hover:bg-paper-2",
                  )}
                >
                  <span className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-semibold">{p.label}</span>
                    {next ? (
                      <span className="text-xs tabular-nums text-ink-soft">~{formatUsd(textCostPerRun(next))}</span>
                    ) : null}
                  </span>
                  <span className="text-xs text-mute">{p.help}</span>
                </button>
              );
            })}
          </div>
          <p className="text-xs text-mute">
            {activePreset ? `Using the ${PRESETS.find((p) => p.id === activePreset)?.label} preset.` : "Custom mix of models."}{" "}
            Text cost per campaign is shown on each preset.
          </p>
        </div>

        <button
          type="button"
          aria-expanded={advancedOpen}
          onClick={() => setAdvancedOpen((o) => !o)}
          className="self-start text-sm font-medium text-signal underline-offset-2 hover:underline"
        >
          {advancedOpen ? "Hide advanced" : "Advanced: choose a model per agent"}
        </button>

        {advancedOpen ? (
          <div className="hairline divide-y divide-line">
            {AGENT_SLOTS.map((slot) => {
              const assigned = getLlmOrDefault(settings.agents[slot.id].modelId);
              const connected = conn.ok("llm", assigned.providerId);
              const providerName = LLM_PROVIDERS.find((p) => p.id === assigned.providerId)?.name ?? assigned.provider;
              const groups = LLM_PROVIDERS.filter(
                (p) => OFFERED_LLM_PROVIDERS.includes(p.id) || p.id === assigned.providerId,
              );
              return (
                <div
                  key={slot.id}
                  className="flex flex-col gap-3 px-4 py-4 md:grid md:grid-cols-[1fr_20rem] md:items-start md:gap-6"
                >
                  <div>
                    <label htmlFor={`agent-${slot.id}`} className="text-sm font-semibold">
                      {slot.label}
                    </label>
                    <p className="text-xs text-mute">{slot.help}</p>
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <select
                      id={`agent-${slot.id}`}
                      value={assigned.id}
                      onChange={(e) => {
                        const next = getLlmOrDefault(e.target.value);
                        updateSettings({
                          agents: {
                            ...settings.agents,
                            [slot.id as AgentSlot]: { provider: next.providerId, modelId: next.id },
                          },
                        });
                      }}
                      className="w-full border px-3 py-2 text-sm"
                    >
                      {groups.map((p) => {
                        const groupOk = conn.ok("llm", p.id);
                        return (
                          <optgroup key={p.id} label={groupOk ? p.name : `${p.name} (not connected)`}>
                            {LLM_MODELS.filter((m) => m.providerId === p.id).map((m) => (
                              <option key={m.id} value={m.id} disabled={!groupOk && m.id !== assigned.id}>
                                {m.name} · {m.estimateLabel}
                              </option>
                            ))}
                          </optgroup>
                        );
                      })}
                    </select>
                    <p className="text-xs text-mute">
                      {assigned.bestFor}
                    </p>
                    {!connected ? (
                      <p className="text-xs text-ink-soft">
                        {providerName} isn&rsquo;t connected.{" "}
                        <ConnectLink conn={conn} kind="llm" providerId={assigned.providerId} name={providerName} />
                      </p>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
      </Section>
    </div>
  );
}

/* ---------------------------- Connections tab ---------------------------- */

type TestState = { busy: boolean; result: ConnectionTestResult | null };

function ConnectionsTab({
  conn,
  status,
  setDeviceKey,
  highlightRow,
}: {
  conn: Conn;
  status: ServerStatus | null;
  setDeviceKey: (provider: ProviderId, has: boolean) => void;
  highlightRow: string | null;
}) {
  const settings = useAisle((s) => s.settings);
  const updateSettings = useAisle((s) => s.updateSettings);
  const [tests, setTests] = useState<Record<string, TestState>>({});

  const [baseUrl, setBaseUrl] = useState(settings.localBaseUrl);
  const [localModel, setLocalModel] = useState(settings.localModel);
  const [justSaved, setJustSaved] = useState(false);
  const endpointDirty = baseUrl.trim() !== settings.localBaseUrl || localModel.trim() !== settings.localModel;
  const customInUse = AGENT_SLOTS.some((s) => settings.agents[s.id].modelId === "local:custom");

  const imageProviders = PROVIDERS.filter((p) => ENABLED_IMAGE_PROVIDERS.includes(p.id));
  const textProviders = LLM_PROVIDERS.filter((p) => OFFERED_LLM_PROVIDERS.includes(p.id) && p.id !== "local");
  const planned = [
    ...LLM_PROVIDERS.filter((p) => !OFFERED_LLM_PROVIDERS.includes(p.id)).map((p) => p.name),
    ...PROVIDERS.filter((p) => !ENABLED_IMAGE_PROVIDERS.includes(p.id)).map((p) => p.name),
  ].filter((name, i, all) => all.indexOf(name) === i);

  function agentsUsingLlm(providerId: string) {
    return AGENT_SLOTS.filter((s) => settings.agents[s.id].provider === providerId).map((s) => s.label);
  }
  function imageUsedBy(providerId: string) {
    return getModelOrDefault(settings.imageModelId, "image").providerId === providerId ? ["Image generation"] : [];
  }

  function runTest(
    id: string,
    kind: ConnectionKind,
    providerId: string,
    opts: { key?: string; baseUrl?: string } = {},
  ) {
    setTests((t) => ({ ...t, [id]: { busy: true, result: null } }));
    void testConnection(kind, providerId, opts).then((result) =>
      setTests((t) => ({ ...t, [id]: { busy: false, result } })),
    );
  }

  function controlFor(
    kind: ConnectionKind,
    providerId: string,
    opts: () => { key?: string; baseUrl?: string } = () => ({}),
  ): TestControl | undefined {
    if (!canTest(kind, providerId)) return undefined;
    const id = rowId(kind, providerId);
    return {
      busy: tests[id]?.busy ?? false,
      result: tests[id]?.result ?? null,
      onRun: () => runTest(id, kind, providerId, opts()),
    };
  }

  const localTest = controlFor("llm", "local", () => ({ baseUrl: baseUrl.trim() }));

  return (
    <div className="flex flex-col gap-10">
      <Section
        title="Image providers"
        description="Add your own key to use a provider. Your keys stay in this browser and are never stored on our servers."
      >
        <div className="hairline divide-y divide-line">
          {imageProviders.map((p) => {
            const id = rowId("image", p.id);
            const state = conn.stateOf("image", p.id);
            return (
              <ProviderRow
                key={id}
                id={id}
                name={p.name}
                kinds="Image"
                state={state}
                usedBy={imageUsedBy(p.id)}
                highlighted={highlightRow === id}
                test={controlFor("image", p.id, () => ({
                  key: state === "device" ? getByoKey(p.id) : undefined,
                }))}
              >
                {status?.media[p.id] ? (
                  <WorkspaceKeyField label={p.name} />
                ) : (
                  <MediaKeyEditor
                    provider={p.id}
                    onChange={(has) => {
                      setDeviceKey(p.id, has);
                      setTests((t) => ({ ...t, [id]: { busy: false, result: null } }));
                    }}
                  />
                )}
              </ProviderRow>
            );
          })}
        </div>
      </Section>

      <Section
        title="Language model providers"
        description="These run on the server while a campaign is being made, so keys can't be added here. Your workspace administrator sets them up."
      >
        <div className="hairline divide-y divide-line">
          {textProviders.map((p) => {
            const id = rowId("llm", p.id);
            const envKeys = LLM_MODELS.find((m) => m.providerId === p.id)?.envKeys ?? [];
            return (
              <ProviderRow
                key={id}
                id={id}
                name={p.name}
                kinds="Text"
                state={conn.stateOf("llm", p.id)}
                usedBy={agentsUsingLlm(p.id)}
                highlighted={highlightRow === id}
                test={controlFor("llm", p.id)}
              >
                {status?.llm[p.id] ? (
                  <WorkspaceKeyField label={p.name} />
                ) : (
                  <p className="text-xs text-mute">
                    {p.blurb} Set <code className="rounded bg-paper-2 px-1">{envKeys.join(", ")}</code> on the
                    server, then restart.
                  </p>
                )}
              </ProviderRow>
            );
          })}
        </div>
      </Section>

      <Disclosure
        title="Advanced: local and custom endpoint"
        description="Ollama, LM Studio, vLLM or a LiteLLM gateway. The way to add a model that isn't listed."
      >
        <form
          id={rowId("llm", "local")}
          tabIndex={-1}
          className={cn(
            "grid gap-4 p-4 outline-none md:grid-cols-2",
            highlightRow === rowId("llm", "local") && "bg-signal-soft",
          )}
          onSubmit={(e) => {
            e.preventDefault();
            updateSettings({ localBaseUrl: baseUrl.trim(), localModel: localModel.trim() });
            setJustSaved(true);
          }}
        >
          <div>
            <label htmlFor="local-base" className="text-xs font-medium text-ink-soft">
              Base URL
            </label>
            <input
              id="local-base"
              type="url"
              value={baseUrl}
              onChange={(e) => {
                setBaseUrl(e.target.value);
                setJustSaved(false);
              }}
              placeholder="http://127.0.0.1:11434/v1"
              className="mt-1.5 w-full border px-3 py-2 text-sm outline-none focus:border-signal"
            />
          </div>
          <div>
            <label htmlFor="local-model" className="text-xs font-medium text-ink-soft">
              Model name
            </label>
            <input
              id="local-model"
              value={localModel}
              onChange={(e) => {
                setLocalModel(e.target.value);
                setJustSaved(false);
              }}
              placeholder="llama3.1"
              className="mt-1.5 w-full border px-3 py-2 text-sm outline-none focus:border-signal"
            />
          </div>
          <p className="max-w-xl text-xs text-mute md:col-span-2">
            Requests are made by the server, so the URL must be reachable from where Aisle runs. The model name is
            used by the &ldquo;Custom tag&rdquo; model.
          </p>
          <div className="flex flex-wrap items-center justify-between gap-3 md:col-span-2">
            {localTest ? <TestInline test={localTest} /> : <span />}
            <button
              type="submit"
              disabled={!endpointDirty}
              className="btn-primary rounded-[var(--r-btn)] px-4 py-2 text-sm font-medium disabled:opacity-50"
            >
              Save endpoint
            </button>
          </div>
          {justSaved && !endpointDirty ? (
            <div role="status" className="flex flex-wrap items-center gap-3 text-sm md:col-span-2">
              <span className="text-ok">Saved.</span>
              {customInUse ? null : (
                <>
                  <span className="text-ink-soft">No agent uses the Custom tag model yet.</span>
                  <button
                    type="button"
                    onClick={() => {
                      const next = { ...settings.agents };
                      for (const s of AGENT_SLOTS) next[s.id] = { provider: "local", modelId: "local:custom" };
                      updateSettings({ agents: next });
                    }}
                    className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2"
                  >
                    Use it for all agents
                  </button>
                </>
              )}
            </div>
          ) : null}
        </form>
      </Disclosure>

      {planned.length ? (
        <p className="text-xs text-mute">
          Also planned, not selectable yet: {planned.join(", ")}.
        </p>
      ) : null}
    </div>
  );
}

function TestInline({ test }: { test: TestControl }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        type="button"
        onClick={test.onRun}
        disabled={test.busy}
        className="rounded-[var(--r-btn)] border border-line px-3 py-1.5 text-xs font-medium hover:bg-paper-2 disabled:opacity-50"
      >
        {test.busy ? "Testing…" : "Test endpoint"}
      </button>
      <span role="status" aria-live="polite" className="text-xs">
        {test.result ? (
          <span className={test.result.ok ? "text-ok" : "text-danger"}>
            {test.result.ok ? "✓ " : "✕ "}
            {test.result.message}
          </span>
        ) : null}
      </span>
    </div>
  );
}

/* --------------------------------- Page --------------------------------- */

export default function SettingsPage() {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash.slice(1),
    () => "",
  );
  const { tab, row } = parseHash(hash);

  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [deviceKeys, setDeviceKeys] = useState<Record<string, boolean>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/settings/status")
      .then((res) => (res.ok ? (res.json() as Promise<ServerStatus>) : null))
      .catch(() => null)
      .then((json) => {
        if (cancelled) return;
        if (json) setStatus(json);
        setDeviceKeys(readDeviceKeys(IMAGE_PROVIDER_IDS));
        setReady(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A deep link targets a row on the Connections tab, which mounts in the same commit as the tab switch.
  useEffect(() => {
    if (tab !== "connections" || !row) return;
    const el = document.getElementById(row);
    if (!el) return;
    el.closest("details")?.setAttribute("open", "");
    el.scrollIntoView({ block: "center" });
    el.focus({ preventScroll: true });
  }, [tab, row, ready]);

  const conn = useMemo<Conn>(() => {
    const stateOf = (kind: ConnectionKind, providerId: string) =>
      connectionState(kind, providerId as LlmProviderId & ProviderId, status, deviceKeys);
    return {
      ready,
      stateOf,
      ok: (kind, providerId) => !ready || isConnected(stateOf(kind, providerId)),
      goConnect: (kind, providerId) => {
        window.location.hash = `connections/${kind}:${providerId}`;
      },
    };
  }, [ready, status, deviceKeys]);

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader
        eyebrow="Workspace"
        title="Settings"
        description="Choose the AI models behind each step and connect your providers."
      />

      <div role="tablist" aria-label="Settings sections" className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`panel-${t.id}`}
            onClick={() => {
              window.location.hash = t.id;
            }}
            className={cn(
              "-mb-px rounded-none border-b-2 px-4 py-2.5 text-sm font-medium",
              tab === t.id
                ? "border-signal text-signal"
                : "border-transparent text-ink-soft hover:text-ink",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pb-12 pt-2">
        {tab === "models" ? <ModelsTab conn={conn} /> : null}
        {tab === "connections" ? (
          <ConnectionsTab
            conn={conn}
            status={status}
            highlightRow={row}
            setDeviceKey={(provider, has) => setDeviceKeys((k) => ({ ...k, [provider]: has }))}
          />
        ) : null}
        {tab === "account" ? <ProfileSection /> : null}
      </div>
    </div>
  );
}
