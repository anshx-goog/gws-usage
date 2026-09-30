# gws-usage
# Google Workspace Enterprise Usage & Raw Subscription Telemetry Suite

An enterprise-grade, zero-egress Google Apps Script solution that programmatically compiles Google Workspace operational adoption, collaboration velocity, and complete raw licensing telemetry into an executive Google Sheets dashboard.

---

## Executive Summary & Business Value

In enterprise cloud governance, chief information officers (CIOs) and chief financial officers (CFOs) face continuous friction reconciling two distinct dimensions of their software investments:
1. **The Commercial Procurement Plane:** Contracted subscription pools, evaluation trials, add-on SKUs, and unassigned license headroom.
2. **The Operational Adoption Plane:** 28-day active human collaborators, cross-service application utilization (Gmail, Docs, Sheets, Slides, Drive, Chat, Meet), and infrastructure consumption (storage quotas and 2-Step Verification security posture).

This repository provides an autonomous automation pipeline deployed entirely within your organization's Google Workspace security perimeter. It eliminates manual reporting overhead, bypasses static or filtered catalogs, and queries live Google administrative endpoints to deliver verifiable telemetry directly into Google Sheets.

---

# Disclaimer and Terms of Use

> **Notice:** Please read this disclaimer carefully before using, cloning, or building upon the code and materials provided in this repository.

---

## 1. Scope and Permitted Use

* **Internal Use of Materials:** Any documentation, architecture diagrams, guidelines, or materials other than the sample code itself provided in this repository are for your **internal use only**.
* **Illustrative Purpose Only:** All sample code, scripts, templates, and configurations are provided strictly for the purpose of illustration and reference. They are designed to serve as a baseline or starting point for you to build on top of. 
* **Non-Production Grade:** The sample code is **not intended to be used directly in a production environment** without independent security review, testing, validation, and hardening.
* **Not an Official Product:** Unless explicitly stated otherwise in writing, this project is an open-source sample and not an officially supported Google product or service.

---

## 2. License Grant and Conditions

Subject to your agreement to the terms herein, you are granted a non-exclusive, royalty-free right to use and modify the sample code, and to reproduce and distribute the object code form of the sample code, provided you strictly adhere to the following conditions:

1. **No Trademark or Brand Use:** You agree not to use Google's name, logo, or trademarks to market, endorse, or promote any software product or service in which the sample code is embedded or derived from.
2. **Copyright Notices:** You must include a valid copyright notice on any software product or distribution containing or derived from the sample code.
3. **Subcontractor Protections:** You agree to provide, on behalf of and for the benefit of your subcontractors, a full disclaimer of warranties, an exclusion of liability for indirect and consequential damages, and a commercially reasonable limitation of liability.
4. **Indemnification:** You agree to indemnify, hold harmless, and defend Google, its affiliates, and its suppliers from and against any third-party claims, liabilities, losses, damages, or lawsuits (including reasonable attorneys' fees and legal expenses) that arise or result from your use, modification, or distribution of the sample code or your software product.

---

## 3. No Support, Maintenance, or Service Level Agreements (SLAs)

* **No Technical or Customer Support:** This repository is provided without ongoing customer support, technical assistance, or developer consulting. There are no dedicated engineers, helpdesks, or ticketing systems associated with this code.
* **No SLAs or Response Commitments:** There are **no Service Level Agreements (SLAs)**, uptime guarantees, or guaranteed response/turnaround times for bug fixes, feature requests, or issue reports logged via GitHub Issues or other channels.
* **User Responsibility:** Any maintenance, monitoring, vulnerability scanning, security patching, dependency upgrades, bug fixes, or compatibility updates are **solely the responsibility of the user**. Google and contributors have no obligation to issue updates, maintain backwards compatibility, or correct discovered defects.

---

## 4. Disclaimer of Warranties ("AS IS")

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, ALL MATERIALS, SAMPLE CODE, DOCUMENTATION, AND ASSOCIATED ASSETS ARE PROVIDED STRICTLY **"AS IS"** AND **"AS AVAILABLE"**, WITHOUT WARRANTY OF ANY KIND, EITHER EXPRESS, IMPLIED, STATUTORY, OR OTHERWISE. 

GOOGLE, ITS AFFILIATES, AND ITS CONTRIBUTORS EXPRESSLY DISCLAIM ALL WARRANTIES, INCLUDING BUT NOT LIMITED TO:
* THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT;
* ANY WARRANTIES ARISING OUT OF COURSE OF DEALING, USAGE, OR TRADE PRACTICE;
* ANY GUARANTEE THAT THE CODE WILL BE UNINTERRUPTED, BUG-FREE, SECURE, ACCURATE, OR COMPATIBLE WITH ANY SPECIFIC SYSTEM, RUNTIME, OR ENVIRONMENT.

YOU ASSUME FULL AND SOLE RESPONSIBILITY FOR ASSESSING THE SUITABILITY, ACCURACY, AND SECURITY OF USING OR BUILDING UPON THIS CODE.

---

## 5. Limitation of Liability

TO THE MAXIMUM EXTENT PERMITTED BY APPLICABLE LAW, IN NO EVENT SHALL GOOGLE, ITS AFFILIATES, DIRECTORS, EMPLOYEES, AGENTS, OR SUPPLIERS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, PUNITIVE, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, REVENUE, PROFITS, OR GOODWILL; BUSINESS INTERRUPTION; SYSTEM DOWNTIME; OR SECURITY BREACHES), HOWEVER CAUSED AND UNDER ANY THEORY OF LIABILITY—WHETHER IN CONTRACT, STRICT LIABILITY, TORT (INCLUDING NEGLIGENCE), OR OTHERWISE—ARISING IN ANY WAY OUT OF THE ACCESS TO, USE OF, OR INABILITY TO USE THIS REPOSITORY, SAMPLE CODE, OR MATERIALS, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
