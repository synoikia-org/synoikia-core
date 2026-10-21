---
status: accepted
date: 2026-10-17
---

# A human approves on a page that core shows

## Context and Problem Statement

A call at level `ask`, and each call of a locked operation, needs a human decision (ADR-0004). The answer to a form prompt goes back through the calling client. A scripted client, or a client under prompt injection, could then approve its own writes. Who approves a call, where, and what does the approval allow?

## Decision Drivers

- The approval must come from the human who owns the credential, not from the client.
- The approval must apply only to the parameters and the targets that the approver saw.
- Clients without a usable prompt, such as chat clients without elicitation, must still get approvals.
- An admin can accept less safety for convenience, but only for operations that are not locked.

## Considered Options

- Core shows its own approval page. In-session approval is an opt-in for each endpoint, and never for locked operations.
- The client asks the human with a form prompt, and core accepts the answer.

## Decision Outcome

Chosen option: "Core shows its own approval page", because only a page that core serves to a human it identifies keeps the client out of the decision.

**In-session approval.** An endpoint can allow it with `formElicitationApprovals: 'ask'`. The values are `off` and `ask`, and the default is `off`. Core reads each other stored value as `off`, and removes it at startup. With `ask`, the human approves an operation at `ask` in the agent session. The operation must not be locked and must not need a typed confirmation.

**Pending approval.** Core creates a `pending_approvals` row with:

- the instance, the operation key, and the redacted parameters for display
- `params_hash`: SHA-256 over the canonical JSON of the key, the parameters, the resolved targets and the expected hash
- the summary, `confirm_literal` and the diff
- the client identity, the user who owns the credential (`owner_user_id`), and the MCP session
- `expires_at`: 15 minutes by default, set for each instance

**Channel.** Core uses the first channel that applies, in this order. The audit `detail.approvalChannel` records the channel of the decision.

| Channel | When                                                                                       | Who decides                                                                                               |
| ------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `form`  | In-session approval applies, and the client supports form prompts.                         | The client: the form has no fields. After 30 s without an answer, a caller that can park moves to `link`. |
| `url`   | The client supports URL-mode elicitation.                                                  | The human, on the approval page. The client answer only tells if the page opened.                         |
| `link`  | The client has no channel above, and the caller can park. The execution parks (see below). | The human, on the approval page. With in-session approval, also on the approval card (`card`).            |
| none    | The caller cannot park, or the parked limits are full.                                     | Nobody. Core denies the call at once.                                                                     |

The page token (`approval_links`) is single use, stored as a hash, and valid until the approval expires.

**Approval page** (`/a/:token` on the MCP listener). Core identifies the approver in one of two ways:

- **Page sign-in.** The user signs in on the MCP listener with a password and TOTP, or with OIDC. The session has its own idle and total lengths (`approvalSessionIdleHours`, `approvalSessionAbsoluteDays`). A TOTP change signs out all approval sessions of the user.
- **External provider.** This applies only when there is no page sign-in and the endpoint's effective methods include `external`. The identity must match an enabled user. Self-registration does not apply here.

A page sign-in has priority over the external provider. The audit `detail.approverSignIn` is `session` or `external`. A decision needs a POST with a CSRF token, signed with the double-submit cookie, the approval link and the approver. A GET or a prefetch decides nothing.

The page has three choices: **Deny**, **Approve once** and **Approve for this session**. After the decision, the page runs one static script that tries to close the tab. The CSP allows only this script, by its SHA-256 hash.

**Approval rules.**

1. **Who can approve.** Only the user who owns the credential of the call. Another user gets 403, also an admin. A call without an owner can come only from inside core, for example the test harness. For such a call, an admin decides.
2. **Typed confirmation.** For an operation with typed confirmation, the approver must type `confirm_literal` exactly. `summarize` gets redacted parameters, so the summary and the literal cannot hold a secret. If such an operation has no literal, core refuses the call.
3. **Redacted values.** The approval page shows the same redacted parameters as the audit log (ADR-0007).
4. **Single use.** An approval allows one `invoke` of exactly its `params_hash`. A new call makes a new approval.
5. **Timeout.** An approval that times out is denied. Core never allows a call on timeout.
6. **Targets checked again.** Core resolves the targets again after the approval. If they changed, core refuses the call (`TARGETS_CHANGED`). The plugin gets the approved targets in `InvokeContext.targets`.
7. **Access checked again.** If the level went down while the approval was open, core refuses the call (`access_changed`).
8. **Operation checked again.** Core refuses the call (`OPERATION_CHANGED`) if a sync changed the classification, the lock, the typed confirmation, `sensitiveParams` or `sensitiveResult`. Core redacts the result with the operation as it reads it after the approval.
9. **Reason in the audit.** An approval that ends without approval gives its reason, for example `user_deleted`, in the audit `detail.reason` of the call.
10. **Tool annotations.** `search` has `readOnlyHint: true`. `execute` has `readOnlyHint: false, destructiveHint: true, openWorldHint: true`. The gate does not depend on them.

**Approval states.**

| From      | To          | When                                                                                                                          |
| --------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `pending` | `approved`  | A human approves on the page, or in the agent session: an allowed form or the approval card.                                  |
| `pending` | `denied`    | A human denies, the client declines, there is no channel, or core restarts.                                                   |
| `pending` | `timed_out` | `expires_at` passes.                                                                                                          |
| `pending` | `cancelled` | The `execute` ends, the session closes (not for a parked execution), the endpoint stops, the owner is deleted, or core stops. |

**Parameters in memory only.** The database stores only the redacted copy and `params_hash` of an open approval. The real parameters stay in memory. An approval must never apply to parameters that the approver did not see. So each approval ends when its parameters can be lost:

- **Graceful shutdown** (SIGTERM, SIGINT). Core cancels open approvals first, so waiting clients get a denial. Then it closes the sessions, the listeners, the plugin children and the database.
- **Endpoint stop.** When an endpoint stops (disabled, deleted, plugin disabled, or restarted after a connection change), core cancels its open approvals.
- **Crash.** After a crash, core denies the pending rows at the next start (`denied: server_restart`).

**Parked executions.** A client without a usable prompt still gets each approval. The execution parks: it waits on the server, and the tool call answers at once with `status: awaiting_approval`, the `executionId` and the approval link. This is not an error result. A form approval also parks when the form has no answer after 30 s, because some clients declare forms but do not show them.

- The script continues at the human decision. It does not wait for `resume`. The sandbox time limit starts again.
- `resume(executionId)` waits up to 45 s for a change. It returns the result once, the same link again, a new link, `STILL_RUNNING` or `EXECUTION_NOT_FOUND`.
- Each write of a parked script runs once. The agent must not run the code again.
- **Park again.** A parked script can park again only if each approval before it was given, and at most 10 times. Otherwise core denies the call at once (`park_refused`).
- **Credential.** A parked execution outlives the request that authenticated it. So the gate checks the credential before each call and again after the approval. A revoked or out-of-scope credential, or a disabled user, stops the call with `OPERATION_DISABLED`.
- **Owner.** A parked execution belongs to the principal and the endpoint that started it, not to the MCP session. A request of another owner gets `EXECUTION_NOT_FOUND`, the same as an unknown id.
- **End.** A parked execution ends when its script ends. When the endpoint stops, core cancels the approval and stops the execution, and a later `resume` gets `EXECUTION_ENDED`. A restart loses all parked executions.
- **Audit.** The event `awaiting_approval` records the `executionId`, the `approvalId` and the channel. Each `resume` writes a `call` event with `decision: resumed`.

| Limit                                             | Value  |
| ------------------------------------------------- | ------ |
| Parked executions for each principal and endpoint | 2      |
| Parked executions for each endpoint               | 8      |
| Parked executions in total                        | 32     |
| Wait of one `resume`                              | 45 s   |
| Wait of a form prompt before the call parks       | 30 s   |
| Time a finished result waits for `resume`         | 10 min |
| `resume` calls that wait on one execution         | 1      |

A second waiting `resume` gets `BUSY`.

**Approval card.** The card is an MCP Apps view (extension `io.modelcontextprotocol/ui`). Hosts that support MCP Apps show it in the chat for each `execute` and `resume` result.

- **Resource.** `ui://synoikia/approval`, MIME type `text/html;profile=mcp-app`. Core serves static HTML and script. It loads nothing from other origins and declares no CSP domains.
- **Tools.** `execute` and `resume` set `_meta.ui.resourceUri` to the card. Three tools have `_meta.ui.visibility: ["app"]`, so the model does not see them.
- `approval_status(executionId)` returns the state of a parked execution, the `approvalId` that it waits on, and `resumeWaiting`. It never returns parameters, results or the approver.
- `approval_decide(executionId, approvalId, approve)` decides the approval that the parked execution waits on. If the execution waits on another approval, core refuses with `approval_changed`.
- `session_grant_revoke(grantId)` ends a session grant of the same principal and endpoint.
- `approval_status` and `approval_decide` have the owner check of `resume`.
- **Decisions.** The card decides only when in-session approval applies to the call, and the endpoint allows it at the time of the decision. A card decision never gives a session grant.
- **Page.** For each other approval, the card has no approve control and no confirmation field. It shows the state and opens the approval page through `ui/open-link`. The host renders the card from the tool result, so the agent cannot change the link.
- **Repeat.** A result with `approval.repeat: true` shows no approval on its card, because an earlier card shows that approval.
- **Continue.** A waiting `resume` gets the result at the decision, so the card sends no message. When the state is final and no `resume` waits for 3 polls, the card sends one `ui/message` to continue.
- A host without MCP Apps ignores the card. The agent shows the link from the text result.

**Session grants.** A session grant lets one principal run the operations at `ask` on one endpoint without a question, for a time.

- **Who gives it.** Only a human on the approval page, with **Approve for this session**. A client, the card and form elicitation cannot give one.
- **Scope.** The principal (the credential) and the endpoint of the approved call. A new grant for the same principal and endpoint replaces the old one.
- **Length.** 1 h, 4 h or until midnight (server time). The endpoint setting `sessionGrantMaxHours` (8 by default) is the maximum, and `0` removes the choice. Core applies the maximum again when it makes the grant.
- **Effect.** At step 6 of the gate (ADR-0003), an operation at `ask` runs with `auto-approved:grant:<id>`.
- Locked operations and operations with typed confirmation still need a human. Level `none`, a group at `read` and the access ceiling still refuse.
- The write rate limit, attestation, target resolution, redaction and the audit still apply.
- **End.** At its expiry, at a revoke, when the endpoint stops, when the approver is disabled or deleted, or at a restart. Core keeps grants in memory only.
- **Audit.** `config` events `session_grant.created` and `session_grant.ended`, with the reason. The actor of the creation and of a replacement is the approver.

### Consequences

- Good, because a client cannot approve its own call, unless the admin opts in for operations that are not locked.
- Good, because an approval applies only to the parameters and targets that the approver saw, and only once.
- Good, because chat clients without elicitation still get approvals through a parked execution.
- Bad, because a restart or an endpoint stop denies each open approval, and the agent must make the call again.
- Bad, because a session grant and in-session approval let a client under prompt injection make `ask` calls. ADR-0002 lists these risks.

The model view `approval` shows the flow. The feature files `@id:approval-channels`, `@id:approval-page`, `@id:approval-browsers`, `@id:read-to-write-approval`, `@id:parked-executions`, `@id:approval-card`, `@id:session-grants` and `@id:shutdown` specify its behavior.
