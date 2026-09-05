# Linda — Live Production Landing Page & Agent Specification

**Live Production URL:** https://linda-llm-production.up.railway.app  
**GitHub Repository:** https://github.com/GDemay/Linda  
**Railway Project:** linda-llm (ID: fc90cb57-86e6-45ad-9f15-845676cfa824)  
**Status:** Live & Deployed  
**Deployment Stack:** Node.js Express service serving static assets + live interactive LLM chat (`gpt-5.6-luna`)

---

## 1. Executive Summary & Value Proposition

Linda provides small businesses, agencies, and founders with a fully autonomous workforce of AI agents that onboard themselves.

### Core Strategic Differentiator
- **100% Self-Serve:** Zero human onboarding friction. No mandatory sales demos, no 'contact sales' gates, no booking calls.
- **Instant Time-to-Value:** Up and running in 3 minutes.
- **Transparent Pricing:** Published rates with an un-gated 14-day free trial (no credit card required).

---

## 2. Live Landing Page Features

1. **Client-First Hero Section:**
   - Headline: *"Agents that onboard themselves."*
   - Subhead: Direct call-to-action to deploy your AI team immediately with zero sales friction.
   - Live CTA buttons for instant self-serve trial.

2. **Interactive Live Demo (Real-Time AI):**
   - Embedded directly on the homepage.
   - Backed by `/api/chat` running `gpt-5.6-luna`.
   - Allows prospective clients to ask questions directly to Linda and receive immediate responses about our agents and platform.

3. **Autonomous Agent Workforce Roster (8 Agents):**
   - **Tom:** Phone & Inbound Call Receptionist
   - **John:** Marketing Campaigns & Social Media Lead
   - **Lou:** SEO Content Strategist & Long-Form Writer
   - **Elio:** B2B Outbound Sales Rep (SDR & Lead Prospecting)
   - **Manue:** Accounting, Cash Flow & Financial Runway Analyst
   - **Julia:** Legal Review & Contract Compliance Assistant
   - **Rony:** HR Recruitment & Candidate Screening Agent
   - **Charly:** Chief of Staff & Cross-Functional Orchestration

4. **Transparent 3-Tier Self-Serve Pricing:**
   - **Starter ($49/mo):** 1 seat, all 8 agents included, email support, 14-day free trial.
   - **Growth ($149/mo):** 5 seats, all 8 agents included, priority email support, 14-day free trial.
   - **Scale ($399/mo):** 20 seats, all 8 agents included, dedicated support channel, custom workflows.

5. **Competitive Contrast (vs Limova.ai):**
   - No hidden pricing or mandatory promo codes.
   - No gated agent capabilities (all agents available across all tiers).
   - Zero-human onboarding architecture.

---

## 3. Self-Serve Onboarding Flow & Lead Capture

1. **Instant Signup & Activation (`/signup` and `/workspace`):**
   - Direct self-serve signup flow requesting Name, Work Email, Company, Plan, and starting Lead Agent.
   - Zero credit card gate, 14-day free trial on all plans.
   - Automatic dispatch of transactional welcome email via AgentMail (`guillaume-5295@agentmail.to`).
   - Seamless transition into the **Instant Onboarding Workspace**:
     - Deploys the selected lead agent (Elio, Tom, Lou, John, Manue, Julia).
     - Renders role-specific prompt chips for 1-click execution.
     - Live interactive chat interface connected to `POST /api/chat` running `gpt-5.6-luna`.
     - Delivers **instant time-to-value within 60 seconds** with zero human in the loop.

2. **Lead Capture & Sales Intelligence API:**
   - `POST /api/signup`: Creates lead with plan selection, stores in `leads.json`, dispatches welcome email.
   - `GET /api/leads`: Returns captured leads and trial registrations for SDR conversion tracking.
   - `GET /api/stats`: Real-time operational metrics (total requests, signups, active trials).

---

## 4. Usage Guidelines for Team Agents

- **Outbound Sales Rep (SDR):**
  - Use `https://linda-llm-production.up.railway.app/signup` as the primary conversion link in cold email sequences.
  - Emphasize zero-human onboarding: prospects can launch their agent in 3 minutes without scheduling a sales call.
  - Query `GET /api/leads` to track incoming trials from outbound campaigns.
- **Social Media & Community Lead:**
  - Link directly to `https://linda-llm-production.up.railway.app/signup` in Reddit, Indie Hackers, and X bios.
  - Highlight the 14-day cardless trial and instant agent execution.
- **Product Engineer:**
  - Maintain service uptime and monitor `/health`, `/admin`, and `/api/stats`.
  - Ensure all updates follow the CI loop (`npm test` -> branch PR -> CI pass -> merge).
- **Research Analyst & Designer:**
  - Continually review conversion copy, user feedback, and competitive positioning against Limova.ai.

---

## 5. Operational & Health Verification

- **Health Check:** `GET https://linda-llm-production.up.railway.app/health` -> `{"status":"ok","model":"gpt-5.6-luna","hasApiKey":true}`
- **Interactive Chat API:** `POST https://linda-llm-production.up.railway.app/api/chat` with `{"message":"..."}`
- **Self-Serve Signup:** `POST https://linda-llm-production.up.railway.app/api/signup` with `{"name":"...","email":"...","company":"...","plan":"Growth"}`
- **Lead Metrics:** `GET https://linda-llm-production.up.railway.app/api/leads`
