import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { OAuthService } from '../src/auth/oauth.js';
import { openDatabase } from '../src/db/index.js';
import { auditLog, oauthClients, oauthGrants, users } from '../src/db/schema.js';
import { seedInstance } from './helpers.js';

function setup() {
  const { db, instanceId } = seedInstance(openDatabase(':memory:'));
  db.insert(users)
    .values([
      { id: 'u1', username: 'olga' },
      { id: 'u2', username: 'piet' },
    ])
    .run();
  return { db, instanceId };
}

describe('own credentials', () => {
  it('revokes only a grant of the user', () => {
    const { db } = setup();
    db.insert(oauthClients)
      .values({ id: 'c1', clientId: 'cid', name: 'x', redirectUris: [], registeredVia: 'dcr' })
      .run();
    db.insert(oauthGrants).values({ id: 'g1', clientId: 'c1', userId: 'u2', resources: [] }).run();
    const oauth = new OAuthService(db);
    expect(() => oauth.revokeOwnGrant('g1', 'u1')).toThrow(expect.objectContaining({ code: 'grant_not_found' }));
    expect(db.select().from(oauthGrants).where(eq(oauthGrants.id, 'g1')).get()?.revokedAt).toBeNull();
    oauth.revokeOwnGrant('g1', 'u2');
    expect(db.select().from(oauthGrants).where(eq(oauthGrants.id, 'g1')).get()?.revokedAt).not.toBeNull();
    const audit = db.select().from(auditLog).where(eq(auditLog.decision, 'oauth_grant_revoked')).all();
    expect(audit.map((a) => a.actorId)).toEqual(['u2']);
  });
});
