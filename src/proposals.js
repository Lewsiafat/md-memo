import crypto from 'crypto';

// In-memory one-time registry for agent write proposals (H1). The apply
// endpoint consumes proposals by id, so replays (double-click, restored
// sessions, tampered args) get nothing. Server restart drops pending
// proposals by design — the user just re-runs the agent.
const MAX_PENDING = 200;
const pending = new Map();

// Store a proposal, return its one-time id. Oldest entries are evicted
// beyond MAX_PENDING so abandoned streams can't grow the map forever.
export function registerProposal(proposal) {
  const id = crypto.randomUUID();
  pending.set(id, proposal);
  if (pending.size > MAX_PENDING) {
    pending.delete(pending.keys().next().value);   // Map iterates in insertion order
  }
  return id;
}

// Retrieve and consume. Unknown or already-used ids return null.
export function takeProposal(id) {
  const proposal = pending.get(id) ?? null;
  pending.delete(id);
  return proposal;
}
