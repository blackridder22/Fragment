import {
  createVaultFixture,
  FIXTURE_SIZES,
  fixtureDigest,
  serializeVaultFixture,
} from "./vault-fixture-lib.mjs";

for (const size of [...FIXTURE_SIZES].reverse()) {
  const first = serializeVaultFixture(createVaultFixture(size));
  const second = serializeVaultFixture(createVaultFixture(size));
  if (first !== second) {
    throw new Error(`Vault fixture ${size} is not deterministic`);
  }

  const parsed = JSON.parse(first);
  if (parsed.size !== size || parsed.fragments.length !== size) {
    throw new Error(`Vault fixture ${size} failed its round-trip check`);
  }
  console.log(`vault-${size}.json\t${fixtureDigest(first)}\tverified`);
}
