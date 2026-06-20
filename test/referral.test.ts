// Referral activation flow: 3 activated friends unlock 1 month of Premium for the referrer,
// using the exact activation predicate from the PDF (opened-from-referral + phone-verified +
// location + 3 products/searches), with self-referral and duplicate guards.

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../src/app.ts";
import { loadConfig } from "../src/config.ts";
import { seedDemo } from "../src/seed.ts";

test("three activated referrals grant the referrer one month of Premium", async () => {
  const app = buildApp(loadConfig());
  const seed = await seedDemo(app);

  // Referrer is set up and phone-verified (required to claim the reward).
  const referrer = app.identity.createAnonymousUser({ metro: seed.metro });
  app.identity.setLocation(referrer.id, "84101", seed.metro);
  app.identity.setPhoneVerified(referrer.id, true);
  assert.equal(app.entitlements.isPremium(referrer.id), false);

  for (let i = 0; i < 3; i++) {
    const invite = app.referral.createInvite(referrer.id);
    const friend = app.identity.createAnonymousUser({ metro: seed.metro });

    // Friend opens the link, then activates: location + phone + builds a first list (3 items).
    app.referral.recordOpen(invite.token, friend.id);
    app.identity.setLocation(friend.id, "84105", seed.metro);
    app.identity.setPhoneVerified(friend.id, true);
    const list = app.lists.createList(friend.id, "First list");
    for (const productId of [seed.products.eggs, seed.products.milk, seed.products.bread]) {
      app.lists.addItem({ listId: list.id, ownerId: friend.id, productId });
    }

    const status = await app.referral.evaluate(friend.id);
    assert.equal(status, "activated", `friend ${i} should activate`);
  }

  const progress = app.referral.progress(referrer.id);
  assert.equal(progress.activated, 3);
  assert.equal(app.entitlements.isPremium(referrer.id), true);
});

test("a friend who has not built a list yet does not activate", async () => {
  const app = buildApp(loadConfig());
  const seed = await seedDemo(app);
  const referrer = app.identity.createAnonymousUser({ metro: seed.metro });
  app.identity.setPhoneVerified(referrer.id, true);

  const invite = app.referral.createInvite(referrer.id);
  const friend = app.identity.createAnonymousUser({ metro: seed.metro });
  app.referral.recordOpen(invite.token, friend.id);
  app.identity.setPhoneVerified(friend.id, true);
  app.identity.setLocation(friend.id, "84105", seed.metro);
  // No items added → predicate fails.
  assert.equal(await app.referral.evaluate(friend.id), "joined");
});

test("self-referral is marked ineligible", () => {
  const app = buildApp(loadConfig());
  const u = app.identity.createAnonymousUser({ metro: "slc" });
  const invite = app.referral.createInvite(u.id);
  const r = app.referral.recordOpen(invite.token, u.id);
  assert.equal(r?.status, "ineligible");
  assert.equal(r?.ineligibleReason, "self_referral");
});
