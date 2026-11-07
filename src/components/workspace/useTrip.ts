"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TripView } from "@/server/tripService";
import type { ChatMessageView, ProposalView } from "@/server/proposals";
import type { TripOperation } from "@/domain/trip";
import { api, ApiError, patch, post } from "@/lib/clientApi";

export type SaveStatus = "loading" | "saved" | "saving" | "error";

type Payload = { trip?: TripView; messages?: ChatMessageView[] };
export type ImportCommitRow = { name: string; address: string; latitude: number; longitude: number; stopType: "required" | "optional"; notes: string };

/**
 * Owns the trip on the client. Every change is sent with the version it was based on, so the
 * server rejects it if the trip changed elsewhere. Inputs are never cleared on failure.
 */
export function useTrip(tripId: string) {
  const [trip, setTrip] = useState<TripView | null>(null);
  const [messages, setMessages] = useState<ChatMessageView[]>([]);
  const [status, setStatus] = useState<SaveStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const versionRef = useRef<number | null>(null);

  const acceptTrip = useCallback((next: TripView) => {
    versionRef.current = next.version;
    setTrip(next);
  }, []);

  const fetchAll = useCallback(async () => {
    const [nextTrip, chat] = await Promise.all([
      api<TripView>(`/api/trips/${tripId}`),
      api<{ messages: ChatMessageView[] }>(`/api/trips/${tripId}/chat`),
    ]);
    return { nextTrip, messages: chat.messages };
  }, [tripId]);

  const reload = useCallback(async () => {
    const { nextTrip, messages: nextMessages } = await fetchAll();
    acceptTrip(nextTrip);
    setMessages(nextMessages);
    setStatus("saved");
  }, [fetchAll, acceptTrip]);

  useEffect(() => {
    fetchAll()
      .then(({ nextTrip, messages: nextMessages }) => {
        acceptTrip(nextTrip);
        setMessages(nextMessages);
        setStatus("saved");
      })
      .catch((err: unknown) => {
        setStatus("error");
        setError(err instanceof Error ? err.message : "Could not load this trip.");
      });
  }, [fetchAll, acceptTrip]);

  /** Runs one mutation at a time. Concurrent edits are refused rather than racing. */
  const mutate = useCallback(
    async (run: (expectedVersion: number) => Promise<Payload>) => {
      if (busy.current || versionRef.current === null) return false;
      busy.current = true;
      setStatus("saving");
      setError(null);
      try {
        const data = await run(versionRef.current);
        if (data.trip) acceptTrip(data.trip);
        if (data.messages) setMessages(data.messages);
        setStatus("saved");
        return true;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Something went wrong.";
        setError(message);
        setStatus("error");
        if (err instanceof ApiError && err.status === 409) await reload().catch(() => undefined);
        return false;
      } finally {
        busy.current = false;
      }
    },
    [acceptTrip, reload],
  );

  const applyOperations = useCallback(
    (operations: TripOperation[], summary: string) =>
      mutate((expectedVersion) => api<TripView>(`/api/trips/${tripId}/operations`, { method: "POST", body: JSON.stringify({ expectedVersion, operations, summary }) }).then((t) => ({ trip: t }))),
    [mutate, tripId],
  );

  const sendMessage = useCallback((message: string) => mutate(() => post<{ messages: ChatMessageView[] }>(`/api/trips/${tripId}/chat`, { message })), [mutate, tripId]);

  const decideProposal = useCallback(
    (proposal: ProposalView, action: "accept" | "reject", confirmRequired = false) =>
      mutate(() => post<{ trip: TripView; messages: ChatMessageView[] }>(`/api/trips/${tripId}/proposals/${proposal.id}`, { action, confirmRequired })),
    [mutate, tripId],
  );

  const undo = useCallback(() => mutate((expectedVersion) => post<TripView>(`/api/trips/${tripId}/undo`, { expectedVersion }).then((t) => ({ trip: t }))), [mutate, tripId]);

  const updateDetails = useCallback(
    (changes: { name?: string; notes?: string; startDate?: string | null; durationDays?: number | null }) =>
      mutate((expectedVersion) => api<TripView>(`/api/trips/${tripId}`, { method: "PATCH", body: JSON.stringify({ expectedVersion, ...changes }) }).then((t) => ({ trip: t }))),
    [mutate, tripId],
  );

  const runPlaceAction = useCallback(
    (url: string, body: Record<string, unknown> = {}) => mutate((expectedVersion) => post<TripView>(url, { expectedVersion, ...body }).then((t) => ({ trip: t }))),
    [mutate],
  );

  const discoverPlaces = useCallback(() => mutate(() => post<TripView>(`/api/trips/${tripId}/places/discover`, {}).then((t) => ({ trip: t }))), [mutate, tripId]);

  const commitImport = useCallback(
    (rows: ImportCommitRow[]) => mutate((expectedVersion) => post<TripView>(`/api/trips/${tripId}/import/commit`, { expectedVersion, rows }).then((t) => ({ trip: t }))),
    [mutate, tripId],
  );

  const setPlaceStatus = useCallback(
    (placeId: string, placeStatus: "suggested" | "saved" | "dismissed") =>
      mutate(() => patch<TripView>(`/api/trips/${tripId}/places/${placeId}`, { status: placeStatus }).then((t) => ({ trip: t }))),
    [mutate, tripId],
  );

  return { trip, messages, status, error, setError, reload, applyOperations, sendMessage, decideProposal, undo, updateDetails, runPlaceAction, discoverPlaces, setPlaceStatus, commitImport, tripId };
}
