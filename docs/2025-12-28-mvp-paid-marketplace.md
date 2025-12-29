# MVP 3: Paid Skills Marketplace

> Gumroad for AI agent skills

---

## Problem Statement

Skill creators have no way to monetize their work. Good skills require significant effort:
- Prompt engineering and iteration
- Testing across edge cases
- Documentation and examples
- Ongoing maintenance

But there's no business model. Creators either give skills away free or don't create them at all.

OpenAI promised GPT Store revenue sharing in January 2024. It's December 2024 and it still doesn't exist.

---

## Scope

**In Scope:**
- Creator pricing controls
- Payment processing (Stripe)
- Access gating for paid skills
- Payout mechanics for creators
- Basic purchase dashboard

**Out of Scope:**
- Discovery/search (assume catalog exists)
- Installation mechanics (assume sksup exists)
- Subscriptions (one-time purchase only for MVP)
- Refunds (manual for MVP)
- Teams/licenses (individual only for MVP)

---

## Core User Flows

### Creator Flow

```
1. Create skill in GitHub repo
2. Submit to Skills Supply catalog
3. Go to skills.supply/creator/pricing
4. Set price for skill ($1 - $999)
5. Connect Stripe account
6. Skill becomes purchasable
7. Get weekly payouts
```

### Buyer Flow

```
1. Find skill in catalog
2. Click "Buy Skill" ($X)
3. Stripe Checkout opens
4. Complete payment
5. Skill is unlocked
6. Run: sksup install gh:creator/skill (now works)
7. Email receipt with install instructions
```

---

## Purchase Flow Details

### Skill Detail Page (Paid Skill)

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  seo-optimizer                                  ✓ Verified      │
│  by @marketingpro                                               │
│                                                                 │
│  Optimizes content for search engines. Analyzes keywords,       │
│  suggests improvements, writes meta descriptions.               │
│                                                                 │
│  ⭐ 892 purchases   |   4.8★ average rating                     │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │                                                           │ │
│  │                    $29 one-time                           │ │
│  │                                                           │ │
│  │                   [Buy Skill →]                           │ │
│  │                                                           │ │
│  │         Instant access · Lifetime updates                 │ │
│  │                                                           │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                                                 │
│  🎮 Try Limited Demo                                            │
│  [Demo available with truncated output]                         │
│                                                                 │
│  📄 What's Included                                             │
│  • Full skill with all capabilities                             │
│  • All future updates                                           │
│  • Source code access                                           │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Checkout Flow

```
1. User clicks "Buy Skill"
2. If not logged in → "Sign in to purchase"
3. Redirect to Stripe Checkout
   - Pre-filled with skill name, price, creator
   - User enters payment details
4. On success:
   - Create purchase record in database
   - Generate/update user's access token
   - Redirect to success page
   - Send receipt email
5. On failure:
   - Redirect to skill page with error
```

### Post-Purchase

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  ✓ Purchase Complete!                                           │
│                                                                 │
│  You now have access to seo-optimizer by @marketingpro          │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📋 Install Now                                                 │
│  ┌───────────────────────────────────────────────────────────┐ │
│  │ sksup install gh:marketingpro/seo-optimizer               │ │
│  └───────────────────────────────────────────────────────────┘ │
│                                            [Copy]               │
│                                                                 │
│  First time? Run: sksup auth login                              │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📧 Receipt sent to you@email.com                               │
│                                                                 │
│  [View in My Purchases →]                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Access Gating

### How Paid Skills Are Protected

When a skill is marked as paid:

1. **Source repo is private** (creator's responsibility)
2. **sksup checks purchase status** before install

```bash
$ sksup install gh:marketingpro/seo-optimizer

Checking access for seo-optimizer...
Error: Purchase required

This is a paid skill ($29).
Purchase at: https://skills.supply/s/marketingpro/seo-optimizer

Already purchased? Run: sksup auth login
```

### Authentication Flow

```bash
$ sksup auth login
Opening browser for authentication...
Waiting for confirmation...

✓ Logged in as you@email.com
  3 purchased skills available

$ sksup install gh:marketingpro/seo-optimizer
✓ Verified purchase
✓ Installing seo-optimizer...
✓ Done
```

### Technical Implementation

```typescript
// sksup install flow for paid skills
async function installSkill(source: string) {
  const skill = await getSkillMetadata(source);

  if (skill.is_paid) {
    const token = await getStoredToken();
    if (!token) {
      throw new Error("Purchase required. Run: sksup auth login");
    }

    const access = await verifyAccess(token, skill.id);
    if (!access.has_purchased) {
      throw new Error(`Purchase required ($${skill.price})`);
    }

    // Clone private repo using user's access token
    await cloneWithToken(skill.source_url, access.repo_token);
  } else {
    // Public skill, clone directly
    await clonePublic(skill.source_url);
  }
}
```

### Why This Works

- **Source repo stays private**: Creator controls access via GitHub
- **We issue per-user tokens**: On purchase, we grant user access to private repo
- **No DRM, no lockdown**: Once installed, skill works offline
- **Lifetime access**: Purchase = permanent access to repo

---

## Pricing Model

### One-Time Purchase

```
Minimum: $1
Maximum: $999
Creator sets price
No subscriptions (for MVP)
No pay-what-you-want (adds friction)
```

### Why One-Time (Not Subscription)

1. **Simplicity**: No recurring billing complexity
2. **Mental model**: "Buy a tool" is clear
3. **Creator preference**: Most want simple payment, not ongoing relationship
4. **Buyer preference**: No subscription fatigue

### Future: Subscription Option

Post-MVP, offer subscription for skills that need it:
- Regularly updated content
- API-backed skills with costs
- Support/consulting included

---

## Platform Economics

### Fee Structure

```
Creator sets price:           $29.00
Stripe fees (~3%):           -$0.87
Platform fee (10%):          -$2.90
─────────────────────────────────────
Creator receives:            $25.23
```

### Why 10%

- **Competitive**: App Store 30%, Gumroad 10%, GitHub Sponsors 0%
- **Sustainable**: Covers infrastructure, support, discovery
- **Fair**: Creator keeps 87% of sale

---

## Payouts

### Stripe Connect

```
1. Creator signs up
2. "Connect Stripe" button → Stripe Connect onboarding
3. Stripe handles KYC, tax forms, bank setup
4. Creator is now connected
```

### Payout Schedule

```
Frequency: Weekly (every Monday)
Minimum: None (even $1 pays out)
Delay: 7 days after purchase (for chargebacks)
```

### Creator Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  CREATOR DASHBOARD                                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  💰 Earnings                                                    │
│                                                                 │
│  This Week:        $523.40                                      │
│  This Month:     $2,891.20                                      │
│  All Time:      $12,456.80                                      │
│                                                                 │
│  Next Payout: Monday, Dec 30 — $523.40                         │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  📊 Sales                                                       │
│                                                                 │
│  seo-optimizer         $29    18 sales    $522.00              │
│  keyword-research      $19     4 sales     $76.00              │
│  content-atomizer      $39     2 sales     $78.00              │
│                                                                 │
│  ───────────────────────────────────────────────────────────    │
│                                                                 │
│  ⚙️ Settings                                                    │
│                                                                 │
│  [Update Stripe Account]                                        │
│  [View Payout History]                                          │
│  [Download Tax Documents]                                       │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Buyer Dashboard

```
┌─────────────────────────────────────────────────────────────────┐
│  MY PURCHASES                                                   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  You have 3 purchased skills                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ seo-optimizer                              Purchased     │   │
│  │ by @marketingpro                          Dec 28, 2024   │   │
│  │                                                          │   │
│  │ sksup install gh:marketingpro/seo-optimizer              │   │
│  │                                                [Copy]    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ keyword-research                           Purchased     │   │
│  │ by @marketingpro                          Dec 15, 2024   │   │
│  │                                                          │   │
│  │ sksup install gh:marketingpro/keyword-research           │   │
│  │                                                [Copy]    │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Download All Receipts]                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Purchase Record

```typescript
interface Purchase {
  id: string;
  user_id: string;
  skill_id: string;

  // Payment
  amount_cents: number;
  currency: "usd";
  stripe_payment_intent_id: string;
  stripe_charge_id: string;

  // Status
  status: "completed" | "refunded" | "disputed";

  // Timestamps
  purchased_at: Date;
  refunded_at?: Date;
}
```

### Skill Pricing

```typescript
interface SkillPricing {
  skill_id: string;
  is_paid: boolean;
  price_cents: number;         // 2900 = $29.00
  currency: "usd";

  // Stripe
  stripe_price_id: string;
  stripe_product_id: string;

  // Creator
  creator_id: string;
  creator_stripe_account_id: string;
}
```

---

## What Makes Creators Sell Here

### The Pitch

> "Upload your skill, set a price, get paid weekly. We handle everything else."

### Comparison: Selling Here vs Giving Away Free

| If You Give Away Free (GitHub) | If You Sell Here |
|-------------------------------|------------------|
| You handle: docs, support, updates, promotion | We handle: hosting, payments, support |
| You get: GitHub stars | You get: Money in your bank account |
| Users get: Maybe works, no support | Buyers get: Works, updates, support expectation |

### The Core Insight

**Creators don't want to run businesses. They want to get paid for good work.**

Running a business means:
- Setting up payment processing
- Handling refunds
- Managing licenses
- Doing marketing
- Providing support

We do all of that. Creator just makes a good skill.

---

## What We Skip (For MVP)

1. **Subscriptions** — One-time only. Subscriptions add complexity.
2. **Bundles** — Buy skills individually. Bundles later.
3. **Team licenses** — Individual purchases only. Teams later.
4. **Refunds UX** — Manual refunds via support. Self-serve later.
5. **Coupons/Discounts** — Full price only. Marketing tools later.
6. **Affiliate program** — Direct sales only. Affiliates later.
7. **Regional pricing** — USD only. Multi-currency later.

---

## Success Metrics

1. **Creator conversion**: % of catalog skills that go paid
2. **GMV**: Total sales volume per month
3. **Creator earnings**: Average monthly earnings per creator
4. **Purchase rate**: % of skill page views → purchase
5. **Repeat purchases**: % of buyers who buy multiple skills

---

## Technical Notes

### Stripe Integration

```typescript
// Create purchase session
const session = await stripe.checkout.sessions.create({
  mode: "payment",
  line_items: [{
    price: skill.stripe_price_id,
    quantity: 1,
  }],
  payment_intent_data: {
    application_fee_amount: Math.round(skill.price_cents * 0.10),
    transfer_data: {
      destination: creator.stripe_account_id,
    },
  },
  success_url: `${BASE_URL}/purchase/success?session_id={CHECKOUT_SESSION_ID}`,
  cancel_url: `${BASE_URL}/s/${skill.id}`,
});
```

### Webhook Handler

```typescript
// Handle successful payment
app.post("/webhooks/stripe", async (req, res) => {
  const event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;

    // Create purchase record
    await db.purchases.create({
      user_id: session.metadata.user_id,
      skill_id: session.metadata.skill_id,
      stripe_payment_intent_id: session.payment_intent,
      amount_cents: session.amount_total,
      status: "completed",
    });

    // Grant repo access
    await grantRepoAccess(session.metadata.user_id, session.metadata.skill_id);

    // Send receipt
    await sendReceiptEmail(session.customer_email, session.metadata.skill_id);
  }
});
```

---

## The 10x Insight

**The bottleneck isn't payment processing. It's everything else.**

Stripe makes payments easy. But selling digital products requires:
- Discovery (people finding your product)
- Trust (people believing it's worth the price)
- Delivery (people receiving what they paid for)
- Support (people getting help when stuck)

We provide all of that. Creator just makes the skill.

**The real value prop: Zero marketing effort required.**

Upload skill. Set price. Sales appear. Money appears in bank account weekly.

That's it.
