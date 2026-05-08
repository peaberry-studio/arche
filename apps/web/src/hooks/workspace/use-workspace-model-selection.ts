"use client";

import { useCallback, useMemo, useRef, useState, type SetStateAction } from "react";

import { listModelsAction } from "@/actions/opencode";
import type { WorkspaceMessage, AvailableModel } from "@/lib/opencode/types";
import { normalizeProviderId } from "@/lib/providers/catalog";
import {
  createDefaultSessionSelectionState,
  filterModelsByProviderStatus,
  findAgentInCatalog,
  getPrimaryAgent,
  getSessionSelectionKey,
  hasModelEntry,
  parseModelString,
  resolveModelEntry,
  type AgentCatalogItem,
  type SessionSelectionState,
} from "@/hooks/workspace/workspace-types";

type UseWorkspaceModelSelectionOptions = {
  slug: string;
  getActiveSessionId: () => string | null;
};

export function useWorkspaceModelSelection({ slug, getActiveSessionId }: UseWorkspaceModelSelectionOptions) {
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [agentCatalog, setAgentCatalog] = useState<AgentCatalogItem[]>([]);
  const [sessionSelectionState, setSessionSelectionState] = useState<
    Record<string, SessionSelectionState>
  >({});
  const sessionSelectionStateRef = useRef(sessionSelectionState);

  const updateSessionSelectionState = useCallback(
    (updater: SetStateAction<Record<string, SessionSelectionState>>) => {
      const current = sessionSelectionStateRef.current;
      const next = typeof updater === "function" ? updater(current) : updater;
      sessionSelectionStateRef.current = next;
      setSessionSelectionState(next);
    },
    []
  );

  const primaryAgent = useMemo(() => getPrimaryAgent(agentCatalog), [agentCatalog]);
  const primaryAgentId = primaryAgent?.id ?? null;

  const agentDefaultModel = useMemo(() => {
    const primaryModel = parseModelString(primaryAgent?.model);
    if (!primaryModel) return null;

    return resolveModelEntry(
      primaryModel.providerId,
      primaryModel.modelId,
      models
    );
  }, [models, primaryAgent?.model]);

  const updateSessionSelection = useCallback(
    (
      sessionId: string,
      updater: (current: SessionSelectionState) => SessionSelectionState
    ) => {
      updateSessionSelectionState((prev) => {
        const current = prev[sessionId] ?? createDefaultSessionSelectionState(primaryAgentId);
        const next = updater(current);
        if (
          next.manualModel === current.manualModel &&
          next.runtimeModel === current.runtimeModel &&
          next.activeAgentId === current.activeAgentId
        ) {
          return prev;
        }

        return {
          ...prev,
          [sessionId]: next,
        };
      });
    },
    [primaryAgentId, updateSessionSelectionState]
  );

  const clearSessionSelectionState = useCallback(
    (sessionId: string) => {
      updateSessionSelectionState((prev) => {
        if (!(sessionId in prev)) return prev;

        const next = { ...prev };
        delete next[sessionId];
        return next;
      });
    },
    [updateSessionSelectionState]
  );

  const initializeSessionSelectionState = useCallback(
    (sessionId: string, seed?: SessionSelectionState) => {
      updateSessionSelection(sessionId, () =>
        seed
          ? {
              manualModel: seed.manualModel,
              runtimeModel: seed.runtimeModel,
              activeAgentId: seed.activeAgentId,
            }
          : createDefaultSessionSelectionState(primaryAgentId)
      );
    },
    [primaryAgentId, updateSessionSelection]
  );

  const setSelectedModel = useCallback(
    (model: AvailableModel | null) => {
      const selectionKey = getSessionSelectionKey(getActiveSessionId());

      updateSessionSelection(selectionKey, (current) => ({
        ...current,
        manualModel: model,
      }));
    },
    [getActiveSessionId, updateSessionSelection]
  );

  const syncRuntimeSelectedModel = useCallback(
    (sessionId: string, providerId?: string, modelId?: string) => {
      if (!providerId || !modelId) return;

      const normalizedProviderId = normalizeProviderId(providerId);

      updateSessionSelection(sessionId, (current) => {
        if (
          current.runtimeModel?.providerId === normalizedProviderId &&
          current.runtimeModel?.modelId === modelId
        ) {
          return current;
        }

        return {
          ...current,
          runtimeModel: resolveModelEntry(normalizedProviderId, modelId, models),
        };
      });
    },
    [models, updateSessionSelection]
  );

  const syncActiveAgentFromRuntime = useCallback(
    (sessionId: string, agentId: string) => {
      updateSessionSelection(sessionId, (current) => {
        const resolved = findAgentInCatalog(agentCatalog, agentId);
        if (!resolved) return current;

        return {
          ...current,
          activeAgentId: resolved.id,
        };
      });
    },
    [agentCatalog, updateSessionSelection]
  );

  const extractRuntimeMetadata = useCallback((items: WorkspaceMessage[]) => {
    const reversed = [...items].reverse();

    for (const message of reversed) {
      if (message.role !== "assistant") continue;

      let agentId = message.agentId;
      const parts = [...(message.parts ?? [])].reverse();
      for (const part of parts) {
        if (part.type === "subtask") {
          agentId = part.agent;
          break;
        }
        if (part.type === "agent") {
          agentId = part.name;
          break;
        }
      }

      return {
        agentId: agentId ?? null,
        model: message.model ?? null,
      };
    }

    return { agentId: null, model: null };
  }, []);

  const syncRuntimeMetadataForSession = useCallback(
    (sessionId: string, items: WorkspaceMessage[]) => {
      const runtime = extractRuntimeMetadata(items);
      updateSessionSelection(sessionId, (current) => ({
        ...current,
        activeAgentId: runtime.agentId
          ? findAgentInCatalog(agentCatalog, runtime.agentId)?.id ?? current.activeAgentId
          : primaryAgentId,
        runtimeModel: runtime.model
          ? resolveModelEntry(runtime.model.providerId, runtime.model.modelId, models)
          : null,
      }));
    },
    [agentCatalog, extractRuntimeMetadata, models, primaryAgentId, updateSessionSelection]
  );

  const loadModels = useCallback(async () => {
    const result = await listModelsAction(slug);
    if (!result.ok || !result.models) return;

    let nextModels = result.models;

    try {
      const response = await fetch(`/api/u/${slug}/providers`, {
        cache: "no-store",
      });
      if (response.ok) {
        const data = (await response.json()) as {
          providers?: { providerId: string; status: string }[];
        };
        nextModels = filterModelsByProviderStatus(
          nextModels,
          data.providers ?? []
        );
      }
    } catch {
      // ignore — fall back to server action list
    }

    setModels(nextModels);

    updateSessionSelectionState((prev) => {
      let changed = false;
      const next: Record<string, SessionSelectionState> = {};

      for (const [sessionId, state] of Object.entries(prev)) {
        const manualModel = state.manualModel
          ? hasModelEntry(state.manualModel.providerId, state.manualModel.modelId, nextModels)
            ? resolveModelEntry(
                state.manualModel.providerId,
                state.manualModel.modelId,
                nextModels
              )
            : null
          : null;
        const runtimeModel = state.runtimeModel
          ? resolveModelEntry(
              state.runtimeModel.providerId,
              state.runtimeModel.modelId,
              nextModels
            )
          : null;
        const nextState: SessionSelectionState = {
          ...state,
          manualModel,
          runtimeModel,
        };

        next[sessionId] = nextState;
        if (
          nextState.manualModel !== state.manualModel ||
          nextState.runtimeModel !== state.runtimeModel
        ) {
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, [slug, updateSessionSelectionState]);

  const loadAgentCatalog = useCallback(async () => {
    try {
      const response = await fetch(`/api/u/${slug}/agents`, {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as {
        agents?: AgentCatalogItem[];
      } | null;
      if (!response.ok || !data?.agents) return;
      const agents = data.agents;
      const primary = agents.find((agent) => agent.isPrimary);

      setAgentCatalog(agents);
      updateSessionSelectionState((prev) => {
        let changed = false;
        const next: Record<string, SessionSelectionState> = {};

        for (const [sessionId, state] of Object.entries(prev)) {
          const resolvedCurrent = state.activeAgentId
            ? findAgentInCatalog(agents, state.activeAgentId)
            : undefined;
          const nextState: SessionSelectionState = {
            ...state,
            activeAgentId: resolvedCurrent?.id ?? primary?.id ?? state.activeAgentId,
          };

          next[sessionId] = nextState;
          if (nextState.activeAgentId !== state.activeAgentId) {
            changed = true;
          }
        }

        return changed ? next : prev;
      });
    } catch {
      // keep defaults when catalog is unavailable
    }
  }, [slug, updateSessionSelectionState]);

  return {
    models,
    agentCatalog,
    sessionSelectionState,
    sessionSelectionStateRef,
    primaryAgentId,
    agentDefaultModel,
    setSelectedModel,
    syncRuntimeSelectedModel,
    syncActiveAgentFromRuntime,
    syncRuntimeMetadataForSession,
    extractRuntimeMetadata,
    updateSessionSelection,
    clearSessionSelectionState,
    initializeSessionSelectionState,
    loadModels,
    loadAgentCatalog,
  };
}
