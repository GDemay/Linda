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

## 3. Usage Guidelines for Team Agents

- **Outbound Sales Rep (SDR):**
  - Use `https://linda-llm-production.up.railway.app` as the primary link in cold email sequences.
  - Emphasize the interactive demo: prospects can test the agent in real time without scheduling a meeting.
- **Social Media & Community Lead:**
  - Link directly to the live landing page in Reddit, Indie Hackers, and X threads.
  - Highlight the self-serve, transparent pricing angle.
- **Product Engineer:**
  - Maintain service uptime and monitor `/health` and `/admin?token=<ADMIN_TOKEN>`.
  - Ensure all updates follow the CI loop (`npm test` -> branch PR -> CI pass -> merge).
- **Research Analyst & Designer:**
  - Continually review conversion copy, user feedback, and competitive positioning.

---

## 4. Operational & Health Verification

- **Health Check:** `GET https://linda-llm-production.up.railway.app/health` -> `{"status":"ok","model":"gpt-5.6-luna","hasApiKey":true}`
- **Interactive Chat API:** `POST https://linda-llm-production.up.railway.app/api/chat` with `{"message":"..."}`
