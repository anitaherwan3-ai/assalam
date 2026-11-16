# Vercel Hobby Build Discipline — No-Cost Configuration (Pass 55)

**Team:** Assalam Clinik  
**Plan observed:** Hobby  
**Repository:** `anitaherwan3-ai/assalam`  
**Purpose:** prevent branch migration builds from duplicating on the operational application project without upgrading the plan.

## 1. Confirmed limits

Vercel's current limits documentation (last updated 2026-02-03) lists for Hobby:
- 32 builds per rolling 3,600 seconds;
- 100 deployments per rolling 86,400 seconds;
- one concurrent build.

The deployment history inspected for the Assalam team showed 100 deployment records in the returned recent window spanning approximately 3 hours 44 minutes on 2026-11-16. Both linked projects were building the same repository/branch.

## 2. Configuration applied directly in Vercel

Project `klinikassalaam`:
- `previewDeploymentsDisabled = true`;
- `commandForIgnoringBuildStep = null` (no cancelled ignored-build step configured).

Project `assalam-mysql-preview`:
- remains the sole Preview project for branch `migration/tidb-foundation`;
- its Preview Firebase/TiDB environment variables remain unchanged.

The Production deployment path on `klinikassalaam` has not been disabled. This setting disables Preview Deployments for that project, not the Production deployment from its production branch. The trade-off is that feature/PR previews are no longer created from `klinikassalaam`; migration preview work goes through `assalam-mysql-preview`.

## 3. Why Ignored Build Step was not retained

The Vercel Project Settings documentation explains that a build skipped through the Ignored Build Step is marked CANCELED and still counts as a full deployment against deployment quotas and concurrent build slots. It therefore does not solve the deployment quota problem. The branch-filter ignore command was removed again.

## 4. Operating discipline

1. Keep automated code tests in GitHub Actions; they do not require a Vercel build.
2. Do not trigger deploys per documentation-only commit.
3. Accumulate a coherent package of changes and use the single migration Preview project for end-to-end testing.
4. Verify CI, source integrity and environment separation before any deployment.
5. Never use Production deployment as the TiDB migration test target.

**Cost:** no plan upgrade or paid Vercel feature was enabled.  
**Production data:** no Firebase/Auth/Firestore/TiDB operational data was modified by this configuration change.
