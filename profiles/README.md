# Profiles

This directory is the beginning of the fingerprint asset layer.

Current rule:

- account identity stays outside these files
- fingerprint behavior lives here

That means:

- `email`
- `device_id`
- OAuth credentials

remain account-scoped values, while:

- `client`
- `env`
- `prompt_env`
- `process`

move toward reusable fingerprint assets.

Current subdirectories:

- `fingerprints/`

Current reference style:

- prefer asset IDs such as `example-darwin-arm64`
- allow explicit relative YAML paths only for experiments or temporary overrides

Design intent:

- one Claude account should normally bind to one stable fingerprint profile
- one Claude account should normally bind to one sticky dedicated proxy or a very small sticky proxy set
- many end users sharing the same Claude account should still present one consistent outward fingerprint story
- different Claude accounts should not all share one identical fingerprint story

Scheduler intent:

- the account is the scheduling subject
- the fingerprint asset is one input into that account narrative
- capacity behavior should live in scheduler/account metadata, not inside the fingerprint asset itself

This directory is still file-backed today.
Later it should become the source for a versioned, hot-updateable fingerprint library.
