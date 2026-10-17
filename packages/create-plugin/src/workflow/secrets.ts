const EXAMPLE = /(?:\.|^|\/)(?:example|sample|template)(?:\.[^/]+)?$/;
const CREDENTIAL =
  /(?:^|\/)(?:secrets?(?:\.[^/]+)*\.ya?ml|\.env(?:\..+)?|\.dev\.vars(?:\..+)?|[^/]+\.secret(?:\..+)?|[^/]+\.(?:pem|key|p12|pfx)|id_(?:rsa|dsa|ecdsa|ed25519)|\.npmrc|\.netrc)$/;

/** Staged paths that look like credential files, by name rather than content. */
export const credentialPaths = (files: readonly string[]) =>
  files.filter((f) => !EXAMPLE.test(f) && CREDENTIAL.test(f));
