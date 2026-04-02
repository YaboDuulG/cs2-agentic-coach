# 🏹 Chinghis Scan: CS2 Agentic Coach
> **"Conquering the server, one data point at a time."**

![Version](https://img.shields.io/badge/version-0.1.0--alpha-blue)
![Python](https://img.shields.io/badge/Python-3.12-gold)
![LangGraph](https://img.shields.io/badge/Orchestration-LangGraph-red)
![License](https://img.shields.io/badge/License-Proprietary-black)

**Chinghis Scan** is a state-of-the-art AI coaching ecosystem that transforms raw `.dem` files into elite tactical intelligence. By utilizing a **multi-agent orchestration layer**, it identifies patterns that traditional statistics miss—focusing on the "why" behind rotations, utility timing, and map control.

---

## 🏗️ System Architecture

The project is built on a "Horde" of specialized agents managed by **LangGraph**, ensuring that match analysis is context-aware and logically sound.

* **🛰️ The Great Khan (Orchestrator):** Routes user queries and maintains state across the analysis loop.
* **🐎 The Scout (Data Parser):** A Dockerized `awpy` environment that extracts spatial and event data from CS2 demos.
* **🛡️ The Tactician (Agentic Analyst):** Evaluates "First Contact" success and mid-round rotation efficiency.
* **📜 The Scribe (Strategist):** Generates automated, markdown-ready "Strat Cards" for team preparation.

---

## 🛠️ Tech Stack

| Component | Technology |
| :--- | :--- |
| **Language** | Python 3.14 |
| **Agent Framework** | LangGraph / LangChain |
| **Data Extraction** | awpy |
| **Environment** | Docker, WSL 2 |
| **Storage** | Structured JSON / Vector Embeddings |

---

## 🏔️ Project Roadmap

### Phase 1: The Data Foundation 🟢
* [x] Set up `awpy` parsing environment in WSL 2.
* [ ] Automate extraction of "Kill Events" and "Player Coordinates."
* [ ] Validate JSON output against Faceit/Matchmaking demos.

### Phase 2: The Agentic Loop 🟡
* [ ] Define global state schema for the LangGraph.
* [ ] Implement **Router Logic** to distinguish between tactical vs. statistical queries.
* [ ] Build hallucination guardrails for agent responses.

### Phase 3: Tactical Intelligence ⚪
* [ ] Deploy **FCR (First Contact Resolution)** analysis module.
* [ ] Automated "Early Rotation" detection logic.
* [ ] High-fidelity Markdown "Strat Card" generation.

---

## 🔐 Intellectual Property

This repository is **Private** and **Proprietary**.

* **Owner:** Chinghis Scan
* **License:** All Rights Reserved. See `LICENSE` file for full legal terms.
* **Status:** Confidential Alpha.

---
