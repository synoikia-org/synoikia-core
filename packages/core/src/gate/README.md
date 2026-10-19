# gate/

The permission gate runs these steps in order:

1. **resolveOperation.** The plugin maps the call to a catalog key.
2. **Access.** The group level, the operation's own level, the locked opt-in and the write acknowledgement apply. For a non-admin, the role maximum and the personal level apply too. See `access.ts` and `catalog/role-levels.ts`.
3. **Attestation.** A guide key is checked for an operation that needs one.
4. **Target resolution** and **prepareWrite.**
5. **Classification.**
6. **Session grant**, then **pre-approval.** Admin rules apply, and the caller's own rules too.
7. **Human approval.** A link prompt or a form prompt asks the person. Otherwise the execution parks and gives the page link. A form with no answer also parks.
8. **Invoke.**
9. **Redact.** The operation's `sensitiveResult` applies to the raw result first. Sensitive keys and secret values follow. See `redact.ts`.
10. **Audit.**

Design: [`docs/design/05-call-path.md`](../../../../docs/design/05-call-path.md) §5.2–§5.3, §5.5–§5.8. Roles: §6.4.
