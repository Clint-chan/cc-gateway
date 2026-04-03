# Account Fingerprint Strategy

## Core Rule

The future platform should be **account-centric**, not user-centric.

That means:

- one Claude account owns one stable outward identity
- that account is bound to one default fingerprint profile
- that account should usually be bound to one sticky dedicated proxy or a very narrow sticky proxy set
- many end users behind the same Claude account should still present one consistent fingerprint story to the upstream

## Why

If five users share the same Claude account, but each user leaks a different:

- client persona
- terminal and runtime mix
- prompt environment
- process profile
- proxy region or network class

then the upstream does not see “one account with one stable machine story”.
It sees one account with conflicting device narratives.

That is exactly the kind of cross-signal inconsistency we should avoid.

## Recommended Model

### Account-Scoped Values

These should belong to the Claude account record:

- `email`
- `device_id`
- OAuth credentials
- default proxy binding
- health / cooldown state
- current fingerprint profile binding

These values should remain stable per account.

### Fingerprint-Profile Values

These should live in reusable fingerprint assets:

- `client`
- `env`
- `prompt_env`
- `process`

These values define the outward workstation story.

## Practical Strategy

### Same Account

For one Claude account used by multiple users:

- keep one stable `device_id`
- keep one stable fingerprint profile
- keep one stable proxy class or a very small sticky proxy set
- normalize all clients of that account into the same outward persona
- let the scheduler treat the account as the scarce resource, not the end user

This does not mean every runtime field must be byte-for-byte static forever.
It means the overall story must remain coherent.

### Different Accounts

Different Claude accounts should not all share one identical fingerprint story.

Instead, use a small library of realistic profile families and bind accounts to them deliberately.

Examples of profile dimensions that can differ across accounts:

- platform family
- terminal family
- runtime/tooling mix
- process metric ranges
- proxy region/provider class

The goal is not randomization.
The goal is **cross-account diversity with per-account stability**.

## What This Means For Implementation Priority

This is why the next structural task is the fingerprint asset layer:

1. separate account identity from fingerprint assets
2. make fingerprint assets versioned and reusable
3. let one account bind to one chosen fingerprint asset
4. introduce an account-centric scheduler substrate
5. only after that start real account-pool and proxy-pool implementation

If we skip that step and jump directly to account pool or frontend work, we will harden the wrong data model.

## Current Repository Direction

The current repository has already started this split:

- account identity stays in the runtime config
- fingerprint behavior can now be loaded from `profiles/fingerprints/*.yaml`

That is still file-backed today, but it matches the future platform direction:

- `ClaudeAccount -> fingerprintProfileId`
- `ClaudeAccount -> defaultProxyId`
- `ClaudeAccount -> capacityProfileId`

## Product Implication

From a product-maturity point of view:

- account pool is a valid and necessary direction
- proxy pool is a valid and necessary direction
- neither should become the immediate implementation focus until the fingerprint asset layer and the account-centric scheduler substrate are explicit and stable
