"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { ChatMessageView, ProposalView } from "@/server/proposals";
import { formatDistance, formatDuration } from "@/lib/format";

type Props = {
  messages: ChatMessageView[];
  busy: boolean;
  send: (message: string) => Promise<boolean>;
  decide: (proposal: ProposalView, action: "accept" | "reject", confirmRequired: boolean) => Promise<boolean>;
};

const SUGGESTIONS = ["Add Santa Fe, NM", "Reduce daily driving", "Optimize stop order", "Remove the lunch stop"];

function signed(value: number, unit: "time" | "distance") {
  const sign = value > 0 ? "+" : value < 0 ? "−" : "±";
  const magnitude = Math.abs(value);
  return `${sign}${unit === "time" ? formatDuration(magnitude) : formatDistance(magnitude)}`;
}

export function ChatPanel({ messages, busy, send, decide }: Props) {
  const [draft, setDraft] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages.length]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    if (await send(text)) setDraft("");
  }

  return (
    <div className="flex h-full flex-col">
      <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto p-4" role="log" aria-live="polite" aria-label="Trip assistant conversation">
        {messages.length === 0 && (
          <div className="rounded-lg bg-sky-50 p-3 text-sm text-sky-900">
            Tell me what you want. I will propose changes and show their driving impact. Nothing changes until you accept.
          </div>
        )}
        {messages.map((message) => (
          <div key={message.id} className={message.role === "user" ? "ml-8 rounded-lg bg-sky-600 p-3 text-sm text-white" : message.role === "system" ? "text-center text-xs text-slate-500" : "mr-6 rounded-lg bg-slate-100 p-3 text-sm text-slate-800"}>
            {message.content}
            {message.proposal && <ProposalCard proposal={message.proposal} busy={busy} decide={decide} />}
          </div>
        ))}
      </div>
      <div className="border-t border-slate-200 p-3">
        <div className="mb-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((s) => (
            <button key={s} type="button" onClick={() => setDraft(s)} className="rounded-full border border-slate-300 px-2.5 py-1 text-xs text-slate-700 hover:bg-slate-50">
              {s}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="chat-input" className="sr-only">Message the trip assistant</label>
          <input id="chat-input" value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder="e.g. add Santa Fe" className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" disabled={busy || !draft.trim()} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50">
            Send
          </button>
        </form>
      </div>
    </div>
  );
}

function ProposalCard({ proposal, busy, decide }: { proposal: ProposalView; busy: boolean; decide: Props["decide"] }) {
  const [confirmed, setConfirmed] = useState(false);
  const { impact } = proposal;
  const pending = proposal.status === "pending";
  return (
    <section aria-label={`Proposal: ${proposal.summary}`} className="mt-3 rounded-lg border border-slate-300 bg-white p-3 text-slate-800">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Proposed change · {proposal.status}</p>
      <p className="font-medium">{proposal.summary}</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
        <dt className="text-slate-500">Driving change</dt>
        <dd>{signed(impact.deltaDriveSeconds, "time")} (provider estimate)</dd>
        <dt className="text-slate-500">Distance change</dt>
        <dd>{signed(impact.deltaDistanceMeters, "distance")}</dd>
        <dt className="text-slate-500">Driving days</dt>
        <dd>{impact.before.drivingDays} → {impact.after.drivingDays}</dd>
      </dl>
      {impact.routeErrors.length > 0 && <p className="mt-2 text-xs text-rose-700">Some routes could not be calculated, so this estimate is incomplete.</p>}
      {pending && impact.requiresConfirmation && (
        <label className="mt-3 flex items-start gap-2 rounded bg-rose-50 p-2 text-xs text-rose-900">
          <input type="checkbox" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} className="mt-0.5" />
          I understand this removes a required stop from my trip.
        </label>
      )}
      {pending && (
        <div className="mt-3 flex gap-2">
          <button type="button" disabled={busy || (impact.requiresConfirmation && !confirmed)} onClick={() => decide(proposal, "accept", confirmed)} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
            Accept
          </button>
          <button type="button" disabled={busy} onClick={() => decide(proposal, "reject", false)} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm">
            Reject
          </button>
        </div>
      )}
    </section>
  );
}
