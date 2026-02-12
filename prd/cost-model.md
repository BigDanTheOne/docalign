> Part of [DocAlign PRD](../PRD.md)

## 14. Cost Model

### 14.1 DocAlign Server Costs (Fixed — All Tiers)

DocAlign's server makes zero LLM calls. All LLM tasks run client-side in the GitHub Action. Costs are fixed infrastructure regardless of user count.

| Component | Monthly Cost |
|-----------|-------------|
| Railway hosting (API + worker) | $20-50 |
| Supabase PostgreSQL | $25 |
| Redis (BullMQ) | $10 |
| **Total fixed** | **$55-85/month** |

DocAlign's marginal cost per additional user/repo is effectively $0 (database storage only).

### 14.2 Client Costs (Client Pays via Their API Key)

All LLM costs are borne by the client. Costs vary by repo activity and model choice.

| Operation | Typical Cost | Volume per PR |
|-----------|-------------|---------------|
| Claim extraction (semantic) | ~$0.01-0.05 per doc file | 0-2 files |
| Embedding generation | ~$0.0001 per entity | 5-20 entities |
| Path 1 verification (direct LLM) | ~$0.003-0.012 per claim | 12-14 claims (60-70%) |
| Path 2 verification (agent) | ~$0.02-0.20 per claim | 6-8 typical (30-40%, max 20 per config) |
| Fix generation | ~$0.01-0.05 per finding | 1-5 findings |
| **Total per PR** | **~$0.15-1.50** | depends on claims affected |

| Repo Activity Level | PRs/month | Client Cost/month |
|---------------------|-----------|------------------|
| Low (solo dev) | 20 | ~$3-10 |
| Medium (small team) | 100 | ~$15-50 |
| High (active team) | 300 | ~$45-150 |

### 14.3 Pricing Tiers

| Tier | DocAlign cost | Client cost | Price |
|------|-------------|-------------|-------|
| **Free** | $0 marginal | ~$5-30/month (their API key) | $0 |
| **Pro** | $0 marginal | Same | TBD (feature-based) |

Pro pricing is for features (dashboard, scheduling, analytics, notifications, SSO), not compute. Both tiers use identical execution model.

**Note:** Pricing decisions deferred to go-to-market planning. The cost estimates above are for capacity planning only.
