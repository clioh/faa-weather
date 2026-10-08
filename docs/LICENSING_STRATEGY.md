# Open Core Licensing & Packaging Strategy

## Overview

This document outlines the strategy for packaging and licensing SkyGlass as an open core product while enabling community widget contributions.

## Open Core Model

### Core (Open Source)

Keep these components open source (MIT or AGPL):

- Widget system/SDK and base widget interface (`BaseWidgetProps`, registry pattern)
- Core frontend rendering engine
- Community-contributed widgets
- Basic backend services

### Proprietary (Commercial License)

These components would be commercially licensed:

- Premium widgets (advanced radar, detailed NOTAMs, etc.)
- Mobile app (`packages/mobile`)
- Presence detection with advanced features
- Cloud sync, multi-device support
- Commercial support/SLA

## Recommended Package Structure

```
packages/
├── widget-sdk/          # MIT - public API for widget development
├── core/                # MIT - minimal open runtime
├── community-widgets/   # MIT - community contributions
├── frontend/            # Dual license (AGPL + Commercial)
├── backend/             # Dual license (AGPL + Commercial)
├── mobile/              # Proprietary
└── premium-widgets/     # Proprietary (not in public repo)
```

## Licensing Options

### Option 1: Dual License (AGPL + Commercial)

- AGPL for open source use (requires derivative works to be open source)
- Commercial license for businesses who don't want AGPL obligations
- **Used by:** GitLab, MongoDB, Grafana Enterprise

**Pros:**
- Strong copyleft protects against competitors using code without contributing back
- Clear monetization path for enterprise customers

**Cons:**
- AGPL can deter some contributors and adopters
- More complex licensing to explain

### Option 2: MIT Core + Proprietary Extensions

- Keep core MIT (permissive, encourages adoption)
- Premium features in separate proprietary packages
- **Used by:** Sidekiq, many SaaS products

**Pros:**
- Maximum adoption and contributor friendliness
- Simple to understand

**Cons:**
- Competitors can fork and compete without contributing back
- Must ensure premium features are genuinely valuable

## Community Widget Contributions

### Widget SDK

Create a dedicated package for widget development:

```json
{
  "name": "@skyglass/widget-sdk",
  "license": "MIT",
  "main": "dist/index.js",
  "types": "dist/index.d.ts"
}
```

### Contribution Requirements

1. All community widgets must be MIT licensed
2. Contributors sign a Contributor License Agreement (CLA)
3. Widgets submitted via PR to `packages/community-widgets/`
4. Code review for quality and security

### CLA Options

- **CLA Assistant:** GitHub app that automates CLA signing
- **DCO (Developer Certificate of Origin):** Lighter weight, used by Linux kernel
- **Custom CLA:** Full copyright assignment (allows relicensing)

## Implementation Tasks

- [ ] Create `packages/widget-sdk` with public widget API
- [ ] Extract widget interfaces from frontend to SDK
- [ ] Set up dual licensing structure in package.json files
- [ ] Create CONTRIBUTING.md with widget submission guidelines
- [ ] Choose and implement CLA solution
- [ ] Create `packages/community-widgets` directory
- [ ] Update LICENSE file(s) for dual licensing
- [ ] Document widget development in docs/

## References

- [Open Core Business Model](https://en.wikipedia.org/wiki/Open-core_model)
- [AGPL License](https://www.gnu.org/licenses/agpl-3.0.en.html)
- [CLA Assistant](https://cla-assistant.io/)
- [Developer Certificate of Origin](https://developercertificate.org/)
